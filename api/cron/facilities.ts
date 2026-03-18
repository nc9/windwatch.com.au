import { put } from "@vercel/blob"
import type { VercelRequest, VercelResponse } from "@vercel/node"

export default async function handler(req: VercelRequest, res: VercelResponse) {
	// Verify cron secret
	const auth = req.headers.authorization
	if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
		return res.status(401).json({ error: "Unauthorized" })
	}

	try {
		const { OpenElectricityClient } = await import("openelectricity")
		const client = new OpenElectricityClient()

		// Fetch from both NEM and WEM
		const allFacilities: any[] = []
		for (const network of ["NEM", "WEM"]) {
			const { response } = await client.getFacilities({
				fueltech_id: ["wind"],
				network_id: [network],
				status_id: ["operating"],
			})
			for (const fac of response.data) {
				if (!fac.location) {
					continue
				}
				const units = fac.units
					.filter(
						(u: any) =>
							u.capacity_registered != null && u.data_last_seen != null
					)
					.map((u: any) => ({
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
				const totalCapacity = units.reduce(
					(s: number, u: any) => s + u.capacity,
					0
				)
				allFacilities.push({
					active: false,
					capacityFactor: 0,
					code: fac.code,
					currentPower: 0,
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

		// Fetch power in batches per network
		const now = new Date()
		const toAestNaive = (d: Date) =>
			new Date(d.getTime() + 36_000_000).toISOString().slice(0, 19)
		const oneHourAgo = new Date(now.getTime() - 3_600_000)
		const latestByUnit = new Map<string, number>()

		for (const network of ["NEM", "WEM"]) {
			const codes = allFacilities
				.filter((f) => f.network === network)
				.map((f) => f.code)
			for (let i = 0; i < codes.length; i += 20) {
				try {
					const { datatable } = await client.getFacilityData(
						network as any,
						codes.slice(i, i + 20),
						["power"],
						{ dateStart: toAestNaive(oneHourAgo), interval: "5m" }
					)
					if (!datatable) {
						continue
					}
					for (const row of datatable.getRows()) {
						const power = row.power as number
						if (
							typeof power === "number" &&
							!Number.isNaN(power) &&
							power >= 0
						) {
							latestByUnit.set(row.unit_code as string, power)
						}
					}
				} catch {}
			}
		}

		// Update with power data
		for (const f of allFacilities) {
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

		const totalCapacity = allFacilities.reduce((s, f) => s + f.totalCapacity, 0)
		const totalPower = allFacilities.reduce((s, f) => s + f.currentPower, 0)

		const data = {
			aggregateCapacityFactor:
				totalCapacity > 0
					? Number(((totalPower / totalCapacity) * 100).toFixed(1))
					: 0,
			facilities: allFacilities,
			lastUpdated: now.toISOString(),
			totalCapacity,
			totalPower,
		}

		const { url } = await put(
			"windwatch/facilities.json",
			JSON.stringify(data),
			{
				access: "public",
				addRandomSuffix: false,
				contentType: "application/json",
			}
		)

		return res.json({ facilities: allFacilities.length, ok: true, url })
	} catch (error) {
		console.error("Cron facilities error:", error)
		return res.status(500).json({ error: String(error) })
	}
}
