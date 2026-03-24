/**
 * Backfill hourly wind field data to KV for past 7 days.
 * Uses Open-Meteo archive API for historical wind speed + direction.
 * Run: bun run scripts/backfill-wind-field.ts
 */

import { deflateSync } from "node:zlib"

import { createClient } from "@vercel/kv"

const BBOX = { east: 160, north: -5, south: -48, west: 105 }
const LON_STEPS = 20
const LAT_STEPS = 15
const DAYS_BACK = Number(process.env.DAYS) || 7

// Build grid (same as api/cron/wind.ts)
const allLats: number[] = []
const allLngs: number[] = []
for (let y = 0; y < LAT_STEPS; y++) {
	const lat = Number(
		(
			BBOX.north +
			(y * (BBOX.south - BBOX.north)) / (LAT_STEPS - 1)
		).toFixed(2),
	)
	for (let x = 0; x < LON_STEPS; x++) {
		const lng = Number(
			(
				BBOX.west +
				(x * (BBOX.east - BBOX.west)) / (LON_STEPS - 1)
			).toFixed(2),
		)
		allLats.push(lat)
		allLngs.push(lng)
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
	let c = 0xff_ff_ff_ff
	for (let i = 0; i < crcBuf.length; i++) {
		c ^= crcBuf[i]
		for (let j = 0; j < 8; j++) {
			c = c & 1 ? (c >>> 1) ^ 0xed_b8_83_20 : c >>> 1
		}
	}
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE((c ^ 0xff_ff_ff_ff) >>> 0, 0)
	return Buffer.concat([len, t, data, crc])
}

async function main() {
	const kvUrl = process.env.KV_REST_API_URL
	const kvToken = process.env.KV_REST_API_TOKEN
	if (!kvUrl || !kvToken) {
		console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN")
		process.exit(1)
	}
	const kv = createClient({ url: kvUrl, token: kvToken })

	const now = new Date()
	const startDate = new Date(now.getTime() - DAYS_BACK * 86_400_000)
	const startStr = startDate.toISOString().slice(0, 10)
	const endStr = now.toISOString().slice(0, 10)

	console.log(
		`Fetching ${DAYS_BACK}d hourly wind for ${allLats.length} grid points (${startStr} to ${endStr})...`,
	)

	// Fetch hourly historical data from Open-Meteo in batches
	const BATCH = 50
	const allResults: {
		time: string[]
		speed: number[]
		direction: number[]
	}[] = []

	for (let i = 0; i < allLats.length; i += BATCH) {
		const batchLats = allLats.slice(i, i + BATCH)
		const batchLngs = allLngs.slice(i, i + BATCH)

		const url = new URL("https://archive-api.open-meteo.com/v1/archive")
		url.searchParams.set("latitude", batchLats.join(","))
		url.searchParams.set("longitude", batchLngs.join(","))
		url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m")
		url.searchParams.set("start_date", startStr)
		url.searchParams.set("end_date", endStr)

		const r = await fetch(url.toString())
		if (!r.ok) {
			throw new Error(
				`Open-Meteo archive ${r.status}: ${await r.text()}`,
			)
		}
		const json = await r.json()
		const items = Array.isArray(json) ? json : [json]

		for (const item of items) {
			allResults.push({
				direction: item.hourly.wind_direction_10m,
				speed: item.hourly.wind_speed_10m,
				time: item.hourly.time,
			})
		}

		process.stdout.write(
			`  fetch batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(allLats.length / BATCH)}\n`,
		)

		if (i + BATCH < allLats.length) {
			await new Promise((r) => setTimeout(r, 300))
		}
	}

	const times = allResults[0].time
	console.log(
		`\n${times.length} hourly timestamps, ${allResults.length} grid points`,
	)

	// Build a wind field snapshot for each hour and write to KV
	const KV_KEY = "ts:wind:field"
	let written = 0

	for (let h = 0; h < times.length; h++) {
		const timeStr = times[h] // e.g. "2026-03-17T00:00"
		const ts = new Date(`${timeStr}Z`).getTime()
		if (Number.isNaN(ts)) continue

		const uValues: number[] = []
		const vValues: number[] = []
		for (let g = 0; g < allResults.length; g++) {
			const speed = allResults[g].speed[h] ?? 0
			const dirRad =
				((allResults[g].direction[h] ?? 0) * Math.PI) / 180
			uValues.push(-speed * Math.sin(dirRad))
			vValues.push(-speed * Math.cos(dirRad))
		}

		const uMin = Math.min(...uValues)
		const uMax = Math.max(...uValues)
		const vMin = Math.min(...vValues)
		const vMax = Math.max(...vValues)
		const uRange = uMax - uMin || 1
		const vRange = vMax - vMin || 1

		const pixels = new Uint8Array(LON_STEPS * LAT_STEPS * 4)
		for (let idx = 0; idx < uValues.length; idx++) {
			const px = idx * 4
			pixels[px] = Math.round(
				((uValues[idx] - uMin) / uRange) * 255,
			)
			pixels[px + 1] = Math.round(
				((vValues[idx] - vMin) / vRange) * 255,
			)
			pixels[px + 2] = 0
			pixels[px + 3] = 255
		}

		const pngBuffer = encodePNG(LON_STEPS, LAT_STEPS, pixels)
		const base64 = pngBuffer.toString("base64")

		const windData = {
			bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
			height: LAT_STEPS,
			image: `data:image/png;base64,${base64}`,
			timestamp: new Date(ts).toISOString(),
			uMax,
			uMin,
			vMax,
			vMin,
			width: LON_STEPS,
		}

		await kv.zadd(KV_KEY, {
			member: JSON.stringify(windData),
			score: ts,
		})
		written++

		if (written % 24 === 0) {
			process.stdout.write(
				`  KV: ${written}/${times.length} snapshots\n`,
			)
		}
	}

	// Prune > 7 days
	const cutoff = Date.now() - 7 * 86_400_000
	await kv.zremrangebyscore(KV_KEY, 0, cutoff)

	console.log(`\nDone: wrote ${written} wind field snapshots to KV`)
	console.log(`Range: ${times[0]} → ${times[times.length - 1]}`)
}

main().catch(console.error)
