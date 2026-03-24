import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClient } from "@vercel/kv"

function getKV() {
	const url = process.env.KV_REST_API_URL || process.env.kv_KV_REST_API_URL || ""
	const token = process.env.KV_REST_API_TOKEN || process.env.kv_KV_REST_API_TOKEN || ""
	if (!url || !token) throw new Error("Missing KV env vars")
	return createClient({ url, token })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
	const kv = getKV()
	const fueltech = (req.query.fueltech as string) || "wind"

	try {
		const kvKey = `ts:${fueltech}:facilities`

		// Get earliest and latest timestamps
		const earliest = await kv.zrange(kvKey, 0, 0, { withScores: true })
		const latest = await kv.zrange(kvKey, -1, -1, { withScores: true })
		const count = await kv.zcard(kvKey)

		if (!earliest.length || !latest.length) {
			return res.json({ count: 0, earliest: null, latest: null })
		}

		// withScores returns [member, score, member, score, ...]
		res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300")
		return res.json({
			count,
			earliest: earliest[1],
			latest: latest[1],
		})
	} catch (error) {
		return res.status(500).json({ error: String(error) })
	}
}
