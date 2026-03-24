import type { VercelRequest, VercelResponse } from "@vercel/node"
import { kv } from "@vercel/kv"

export default async function handler(req: VercelRequest, res: VercelResponse) {
	const fueltech = (req.query.fueltech as string) || "wind"
	const from = Number(req.query.from) || 0
	const to = Number(req.query.to) || Date.now()
	const limit = Math.min(Number(req.query.limit) || 288, 2016) // max 7 days at 5min

	try {
		const kvKey = `ts:${fueltech}:facilities`
		const raw = await kv.zrange(kvKey, from, to, {
			byScore: true,
			count: limit,
			offset: 0,
		})
		const snapshots = raw.map((s: any) =>
			typeof s === "string" ? JSON.parse(s) : s
		)

		const meta = await kv.get(`meta:${fueltech}:facilities`)

		res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300")
		return res.json({
			meta: meta ? (typeof meta === "string" ? JSON.parse(meta) : meta) : null,
			snapshots,
		})
	} catch (error) {
		return res.status(500).json({ error: String(error) })
	}
}
