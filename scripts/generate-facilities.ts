import { writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Generate wind facility JSON with live power data.
 * Run with: bun run scripts/generate-facilities.ts
 * Outputs to public/data/facilities.json
 */
import { OpenElectricityClient } from "openelectricity"

const client = new OpenElectricityClient()
const fueltech = process.env.FUELTECH || "wind"

async function main() {
	// Fetch from both NEM and WEM
	const networks = ["NEM", "WEM"]
	const allFacilities: typeof response.data = []

	for (const network of networks) {
		console.log(`Fetching ${network} ${fueltech} facilities...`)
		const { response } = await client.getFacilities({
			fueltech_id: [fueltech],
			network_id: [network],
			status_id: ["operating"],
		})
		allFacilities.push(...response.data)
	}

	// Deduplicate by code
	const seen = new Set<string>()
	const facilities: any[] = []

	for (const fac of allFacilities) {
		if (seen.has(fac.code)) {
			continue
		}
		seen.add(fac.code)
		if (!fac.location) {
			continue
		}
		const units = fac.units
			.filter((u) => u.capacity_registered != null && u.data_last_seen != null)
			.map((u) => ({
				active: false,
				capacity: Number(u.capacity_registered ?? 0),
				capacityFactor: 0,
				code: u.code,
				currentPower: 0,
				lastSeen: u.data_last_seen ?? "",
			}))
		if (units.length === 0) {
			continue
		}
		const totalCapacity = units.reduce((s: number, u: any) => s + u.capacity, 0)
		const dataFirstSeen = fac.units.reduce((earliest: string | null, u: any) => {
			if (!u.data_first_seen) return earliest
			if (!earliest) return u.data_first_seen
			return u.data_first_seen < earliest ? u.data_first_seen : earliest
		}, null)
		facilities.push({
			active: false,
			capacityFactor: 0,
			code: fac.code,
			currentPower: 0,
			dataFirstSeen,
			lat: fac.location.lat,
			lng: fac.location.lng,
			name: fac.name,
			network: fac.network_id,
			region: fac.network_region,
			totalCapacity,
			units,
		})
	}

	// Fetch power in batches, grouped by network
	const now = new Date()
	const toAestNaive = (d: Date) =>
		new Date(d.getTime() + 36_000_000).toISOString().slice(0, 19)
	const oneHourAgo = new Date(now.getTime() - 3_600_000)

	const latestByUnit = new Map<string, number>()

	for (const network of networks) {
		const networkFacilities = facilities.filter((f) => f.network === network)
		const codes = networkFacilities.map((f) => f.code)
		if (codes.length === 0) {
			continue
		}
		console.log(`Fetching power for ${codes.length} ${network} facilities...`)

		for (let i = 0; i < codes.length; i += 20) {
			const batch = codes.slice(i, i + 20)
			try {
				const { datatable } = await client.getFacilityData(
					network as any,
					batch,
					["power"],
					{ dateStart: toAestNaive(oneHourAgo), interval: "5m" }
				)
				if (!datatable) {
					continue
				}
				for (const row of datatable.getRows()) {
					const unitCode = row.unit_code as string
					const power = row.power as number
					if (typeof power !== "number" || Number.isNaN(power) || power < 0) {
						continue
					}
					latestByUnit.set(unitCode, power)
				}
				process.stdout.write(
					`  batch ${Math.floor(i / 20) + 1}/${Math.ceil(codes.length / 20)} done\n`
				)
			} catch (error) {
				console.error(`  batch ${i} error:`, error)
			}
		}
	}

	// Update facilities with power
	for (const f of facilities) {
		let fp = 0
		for (const u of f.units) {
			const power = latestByUnit.get(u.code)
			if (power != null) {
				u.currentPower = power
				u.capacityFactor =
					u.capacity > 0 ? Number(((power / u.capacity) * 100).toFixed(1)) : 0
				u.active = true
				fp += power
			}
		}
		f.currentPower = fp
		f.active = fp > 0
		f.capacityFactor =
			f.totalCapacity > 0
				? Number(((fp / f.totalCapacity) * 100).toFixed(1))
				: 0
	}

	const totalCapacity = facilities.reduce(
		(s: number, f: any) => s + f.totalCapacity,
		0
	)
	const totalPower = facilities.reduce(
		(s: number, f: any) => s + f.currentPower,
		0
	)

	const data = {
		aggregateCapacityFactor:
			totalCapacity > 0
				? Number(((totalPower / totalCapacity) * 100).toFixed(1))
				: 0,
		facilities,
		lastUpdated: now.toISOString(),
		totalCapacity,
		totalPower,
	}

	const outPath = join(
		import.meta.dir,
		`../public/data/${fueltech}-facilities.json`
	)
	writeFileSync(outPath, JSON.stringify(data))
	console.log(
		`\nWritten ${facilities.length} ${fueltech} facilities to ${outPath}`
	)
	console.log(
		`Total: ${Math.round(totalPower)} MW / ${Math.round(totalCapacity)} MW (${data.aggregateCapacityFactor}%)`
	)
}

main().catch(console.error)
