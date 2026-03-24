/**
 * Backfill 3 days of 5-min facility power data into a history JSON file.
 * Run: bun run scripts/backfill-history.ts
 * Or: FUELTECH=solar_utility bun run scripts/backfill-history.ts
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { OpenElectricityClient } from "openelectricity"

const client = new OpenElectricityClient()
const fueltech = process.env.FUELTECH || "wind"
const DAYS_BACK = 3
const FIVE_MIN_MS = 300_000

/** Round ms to nearest 5-minute boundary */
function roundTo5Min(ms: number): number {
	return Math.round(ms / FIVE_MIN_MS) * FIVE_MIN_MS
}

async function main() {
	// 1. Fetch facility metadata
	const networks = ["NEM", "WEM"]
	const allFacilities: any[] = []

	for (const network of networks) {
		console.log(`Fetching ${network} ${fueltech} facilities...`)
		const { response } = await client.getFacilities({
			fueltech_id: [fueltech],
			network_id: [network],
			status_id: ["operating"],
		})
		for (const fac of response.data) {
			if (!fac.location) continue
			const units = fac.units
				.filter(
					(u) => u.capacity_registered != null && u.data_last_seen != null,
				)
				.map((u) => ({
					capacity: Number(u.capacity_registered ?? 0),
					code: u.code,
				}))
			if (units.length === 0) continue
			const totalCapacity = units.reduce((s, u) => s + u.capacity, 0)
			allFacilities.push({
				code: fac.code,
				lat: fac.location.lat,
				lng: fac.location.lng,
				name: fac.name,
				network: fac.network_id,
				region: fac.network_region,
				totalCapacity,
				units,
			})
		}
	}

	console.log(`Found ${allFacilities.length} ${fueltech} facilities`)

	// 2. Fetch power data — grouped by facility
	const now = new Date()
	const toAestNaive = (d: Date) =>
		new Date(d.getTime() + 36_000_000).toISOString().slice(0, 19)
	const startDate = new Date(now.getTime() - DAYS_BACK * 86_400_000)

	// unitCode → Map<roundedUtcMs, power>
	const powerByUnit = new Map<string, Map<number, number>>()

	for (const network of networks) {
		const codes = allFacilities
			.filter((f) => f.network === network)
			.map((f) => f.code)
		if (codes.length === 0) continue

		console.log(
			`Fetching ${DAYS_BACK}d power for ${codes.length} ${network} facilities...`,
		)

		for (let i = 0; i < codes.length; i += 20) {
			const batch = codes.slice(i, i + 20)
			try {
				const { datatable } = await client.getFacilityData(
					network as any,
					batch,
					["power"],
					{ dateStart: toAestNaive(startDate), interval: "5m" },
				)
				if (!datatable) continue

				for (const row of datatable.getRows()) {
					const unitCode = row.unit_code as string
					const power = row.power as number
					const interval = row.interval as string
					if (
						typeof power !== "number" ||
						Number.isNaN(power) ||
						power < 0
					)
						continue

					// Convert AEST-naive → UTC ms, round to 5 min
					const utcMs = roundTo5Min(
						new Date(`${interval}Z`).getTime() - 36_000_000,
					)

					if (!powerByUnit.has(unitCode)) {
						powerByUnit.set(unitCode, new Map())
					}
					powerByUnit.get(unitCode)!.set(utcMs, power)
				}
			} catch (e) {
				console.error(`  batch ${i} error:`, e)
			}
			process.stdout.write(
				`  batch ${Math.floor(i / 20) + 1}/${Math.ceil(codes.length / 20)}\n`,
			)
		}
	}

	// 3. Unit→facility lookup
	const unitToFacility = new Map<string, string>()
	for (const f of allFacilities) {
		for (const u of f.units) {
			unitToFacility.set(u.code, f.code)
		}
	}

	// 4. Collect unique 5-min timestamps
	const allTimestamps = new Set<number>()
	for (const unitMap of powerByUnit.values()) {
		for (const ts of unitMap.keys()) {
			allTimestamps.add(ts)
		}
	}
	const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b)
	console.log(`${sortedTimestamps.length} intervals (5-min rounded)`)

	// 5. Build snapshots
	const totalCapacity = allFacilities.reduce(
		(s: number, f: any) => s + f.totalCapacity,
		0,
	)
	const snapshots: any[] = []

	for (const ts of sortedTimestamps) {
		// Sum power per facility at this timestamp
		const facPower = new Map<string, number>()
		for (const [unitCode, unitMap] of powerByUnit) {
			const power = unitMap.get(ts)
			if (power == null) continue
			const facCode = unitToFacility.get(unitCode)
			if (!facCode) continue
			facPower.set(facCode, (facPower.get(facCode) ?? 0) + power)
		}

		// Skip if no data at this timestamp
		if (facPower.size === 0) continue

		const f: Record<string, [number, number]> = {}
		let totalPower = 0
		for (const fac of allFacilities) {
			const power = facPower.get(fac.code) ?? 0
			const cf =
				fac.totalCapacity > 0
					? Number(((power / fac.totalCapacity) * 100).toFixed(1))
					: 0
			f[fac.code] = [Math.round(power * 100) / 100, cf]
			totalPower += power
		}

		const acf =
			totalCapacity > 0
				? Number(((totalPower / totalCapacity) * 100).toFixed(1))
				: 0

		snapshots.push({
			acf,
			f,
			t: Math.round(totalPower * 100) / 100,
			ts,
		})
	}

	// 6. Write output
	const meta = {
		facilities: allFacilities.map((fac: any) => ({
			code: fac.code,
			lat: fac.lat,
			lng: fac.lng,
			name: fac.name,
			network: fac.network,
			region: fac.region,
			totalCapacity: fac.totalCapacity,
			units: fac.units,
		})),
	}

	const output = { meta, snapshots }
	const json = JSON.stringify(output)
	const outPath = join(
		import.meta.dir,
		`../public/data/history-${fueltech}.json`,
	)
	writeFileSync(outPath, json)

	const sizeMB = (json.length / 1_048_576).toFixed(2)
	console.log(
		`\nWritten ${snapshots.length} snapshots (${sizeMB} MB) to ${outPath}`,
	)
	if (snapshots.length > 0) {
		console.log(
			`Range: ${new Date(snapshots[0].ts).toISOString()} → ${new Date(snapshots.at(-1).ts).toISOString()}`,
		)
	}
}

main().catch(console.error)
