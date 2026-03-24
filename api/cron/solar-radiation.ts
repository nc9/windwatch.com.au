import { deflateSync } from "node:zlib"

import { put } from "@vercel/blob"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClient } from "@vercel/kv"

function getKV() {
	const url = process.env.KV_REST_API_URL || process.env.kv_KV_REST_API_URL || ""
	const token = process.env.KV_REST_API_TOKEN || process.env.kv_KV_REST_API_TOKEN || ""
	if (!url || !token) throw new Error("Missing KV env vars")
	return createClient({ url, token })
}

const BBOX = { east: 160, north: -5, south: -48, west: 105 }
const LON_STEPS = 20
const LAT_STEPS = 15
const MAX_IRRADIANCE = 1200

export default async function handler(req: VercelRequest, res: VercelResponse) {
	// Only run on solar deployments
	if (process.env.VITE_MODE !== "solar") {
		return res.json({ ok: true, skipped: true })
	}

	const auth = req.headers.authorization
	if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
		return res.status(401).json({ error: "Unauthorized" })
	}

	const blobPrefix = process.env.BLOB_PREFIX || "solarwatch"

	try {
		// Build grid
		const allLats: number[] = []
		const allLngs: number[] = []
		for (let y = 0; y < LAT_STEPS; y++) {
			const lat = Number(
				(
					BBOX.north +
					(y * (BBOX.south - BBOX.north)) / (LAT_STEPS - 1)
				).toFixed(2)
			)
			for (let x = 0; x < LON_STEPS; x++) {
				const lng = Number(
					(BBOX.west + (x * (BBOX.east - BBOX.west)) / (LON_STEPS - 1)).toFixed(
						2
					)
				)
				allLats.push(lat)
				allLngs.push(lng)
			}
		}

		// Fetch from Open-Meteo in batches
		const results: any[] = []
		const BATCH = 100
		for (let i = 0; i < allLats.length; i += BATCH) {
			const url = new URL("https://api.open-meteo.com/v1/forecast")
			url.searchParams.set("latitude", allLats.slice(i, i + BATCH).join(","))
			url.searchParams.set("longitude", allLngs.slice(i, i + BATCH).join(","))
			url.searchParams.set("current", "shortwave_radiation,cloud_cover")

			const r = await fetch(url.toString())
			if (!r.ok) {
				throw new Error(`Open-Meteo ${r.status}`)
			}
			const json = await r.json()
			results.push(...(Array.isArray(json) ? json : [json]))

			if (i + BATCH < allLats.length) {
				await new Promise((r) => setTimeout(r, 500))
			}
		}

		// Encode as PNG: R=irradiance, G=cloud_cover
		const pixels = new Uint8Array(LON_STEPS * LAT_STEPS * 4)
		for (let i = 0; i < results.length; i++) {
			const irradiance = results[i].current.shortwave_radiation as number
			const cloudCover = results[i].current.cloud_cover as number
			const px = i * 4
			pixels[px] = Math.round(Math.min(irradiance / MAX_IRRADIANCE, 1) * 255)
			pixels[px + 1] = Math.round(Math.min(cloudCover / 100, 1) * 255)
			pixels[px + 2] = 0
			pixels[px + 3] = 255
		}

		const pngBuffer = encodePNG(LON_STEPS, LAT_STEPS, pixels)
		const base64 = pngBuffer.toString("base64")

		const solarData = {
			bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
			height: LAT_STEPS,
			image: `data:image/png;base64,${base64}`,
			timestamp: new Date().toISOString(),
			width: LON_STEPS,
		}

		const { url } = await put(
			`${blobPrefix}/solar.json`,
			JSON.stringify(solarData),
			{
				access: "public",
				addRandomSuffix: false,
				contentType: "application/json",
			}
		)

		try {
			const kv = getKV()
			const ts = Date.now()
			await kv.zadd("ts:solar:field", {
				member: JSON.stringify(solarData),
				score: ts,
			})
			await kv.zremrangebyscore("ts:solar:field", 0, ts - 7 * 86_400_000)
		} catch (error) {
			console.error("KV solar write error:", error)
		}

		return res.json({ grid: `${LON_STEPS}x${LAT_STEPS}`, ok: true, url })
	} catch (error) {
		console.error("Cron solar-radiation error:", error)
		return res.status(500).json({ error: String(error) })
	}
}

function encodePNG(width: number, height: number, rgba: Uint8Array): Buffer {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	const raw = Buffer.alloc(height * (1 + width * 4))
	for (let y = 0; y < height; y++) {
		const o = y * (1 + width * 4)
		raw[o] = 0
		for (let x = 0; x < width * 4; x++) {
			raw[o + 1 + x] = rgba[y * width * 4 + x]
		}
	}
	const compressed = deflateSync(raw)
	return Buffer.concat([
		sig,
		chunk("IHDR", ihdr),
		chunk("IDAT", compressed),
		chunk("IEND", Buffer.alloc(0)),
	])
}

function chunk(type: string, data: Buffer): Buffer {
	const t = Buffer.from(type, "ascii")
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length, 0)
	const crcBuf = Buffer.concat([t, data])
	let c = 0xFF_FF_FF_FF
	for (let i = 0; i < crcBuf.length; i++) {
		c ^= crcBuf[i]
		for (let j = 0; j < 8; j++) {
			c = c & 1 ? (c >>> 1) ^ 0xED_B8_83_20 : c >>> 1
		}
	}
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE((c ^ 0xFF_FF_FF_FF) >>> 0, 0)
	return Buffer.concat([len, t, data, crc])
}
