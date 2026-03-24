import { kv } from "@vercel/kv"
import type { VercelRequest, VercelResponse } from "@vercel/node"

export default async function handler(req: VercelRequest, res: VercelResponse) {
	const type = (req.query.type as string) || "wind"
	const at = Number(req.query.at) || Date.now()

	try {
		const kvKey = `ts:${type}:field`
		// Get most recent field snapshot at or before requested time
		const raw = await kv.zrange(kvKey, at, 0, {
			byScore: true,
			count: 1,
			offset: 0,
			rev: true,
		})

		if (!raw || raw.length === 0) {
			return res.status(404).json({ error: "No field data found" })
		}

		const data = typeof raw[0] === "string" ? JSON.parse(raw[0]) : raw[0]

		res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600")
		return res.json(data)
	} catch (error) {
		return res.status(500).json({ error: String(error) })
	}
}
