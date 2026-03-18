import type { VercelRequest, VercelResponse } from "@vercel/node"
import { put } from "@vercel/blob"
import { deflateSync } from "node:zlib"

const BBOX = { west: 105, east: 160, south: -48, north: -5 }
const LON_STEPS = 20
const LAT_STEPS = 15

export default async function handler(req: VercelRequest, res: VercelResponse) {
	const auth = req.headers.authorization
	if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
		return res.status(401).json({ error: "Unauthorized" })
	}

	try {
		// Build grid
		const allLats: number[] = []
		const allLngs: number[] = []
		for (let y = 0; y < LAT_STEPS; y++) {
			const lat = Number((BBOX.north + (y * (BBOX.south - BBOX.north)) / (LAT_STEPS - 1)).toFixed(2))
			for (let x = 0; x < LON_STEPS; x++) {
				const lng = Number((BBOX.west + (x * (BBOX.east - BBOX.west)) / (LON_STEPS - 1)).toFixed(2))
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
			url.searchParams.set("current", "wind_speed_10m,wind_direction_10m")

			const r = await fetch(url.toString())
			if (!r.ok) throw new Error(`Open-Meteo ${r.status}`)
			const json = await r.json()
			results.push(...(Array.isArray(json) ? json : [json]))

			if (i + BATCH < allLats.length) await new Promise((r) => setTimeout(r, 500))
		}

		// Convert to U/V
		const uValues: number[] = []
		const vValues: number[] = []
		for (const r of results) {
			const speed = r.current.wind_speed_10m as number
			const dirRad = ((r.current.wind_direction_10m as number) * Math.PI) / 180
			uValues.push(-speed * Math.sin(dirRad))
			vValues.push(-speed * Math.cos(dirRad))
		}

		const uMin = Math.min(...uValues), uMax = Math.max(...uValues)
		const vMin = Math.min(...vValues), vMax = Math.max(...vValues)
		const uRange = uMax - uMin || 1, vRange = vMax - vMin || 1

		// Encode as PNG
		const pixels = new Uint8Array(LON_STEPS * LAT_STEPS * 4)
		for (let i = 0; i < uValues.length; i++) {
			const px = i * 4
			pixels[px] = Math.round(((uValues[i] - uMin) / uRange) * 255)
			pixels[px + 1] = Math.round(((vValues[i] - vMin) / vRange) * 255)
			pixels[px + 2] = 0
			pixels[px + 3] = 255
		}

		const pngBuffer = encodePNG(LON_STEPS, LAT_STEPS, pixels)
		const base64 = pngBuffer.toString("base64")

		const windData = {
			image: `data:image/png;base64,${base64}`,
			width: LON_STEPS,
			height: LAT_STEPS,
			uMin, uMax, vMin, vMax,
			bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
			timestamp: new Date().toISOString(),
		}

		const { url } = await put("windwatch/wind.json", JSON.stringify(windData), {
			access: "public",
			contentType: "application/json",
			addRandomSuffix: false,
		})

		return res.json({ ok: true, grid: `${LON_STEPS}x${LAT_STEPS}`, url })
	} catch (err) {
		console.error("Cron wind error:", err)
		return res.status(500).json({ error: String(err) })
	}
}

function encodePNG(width: number, height: number, rgba: Uint8Array): Buffer {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8; ihdr[9] = 6
	const raw = Buffer.alloc(height * (1 + width * 4))
	for (let y = 0; y < height; y++) {
		const o = y * (1 + width * 4)
		raw[o] = 0
		for (let x = 0; x < width * 4; x++) raw[o + 1 + x] = rgba[y * width * 4 + x]
	}
	const compressed = deflateSync(raw)
	return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))])
}

function chunk(type: string, data: Buffer): Buffer {
	const t = Buffer.from(type, "ascii")
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
	const crcBuf = Buffer.concat([t, data])
	let c = 0xffffffff
	for (let i = 0; i < crcBuf.length; i++) {
		c ^= crcBuf[i]
		for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
	}
	const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0)
	return Buffer.concat([len, t, data, crc])
}
