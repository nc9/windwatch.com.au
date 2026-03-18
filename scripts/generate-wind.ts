/**
 * Fetch wind data from Open-Meteo API and generate wind texture PNG.
 * Run with: bun run scripts/generate-wind.ts
 * Outputs to public/data/wind.json (metadata + inline base64 image data)
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Australia bounding box
const BBOX = { west: 105, east: 160, south: -48, north: -5 }
const LON_STEPS = 20
const LAT_STEPS = 15

async function main() {
	// Build grid points
	const lats: number[] = []
	const lngs: number[] = []
	for (let i = 0; i < LAT_STEPS; i++) {
		lats.push(
			Number(
				(BBOX.north + (i * (BBOX.south - BBOX.north)) / (LAT_STEPS - 1)).toFixed(2),
			),
		)
	}
	for (let i = 0; i < LON_STEPS; i++) {
		lngs.push(
			Number(
				(BBOX.west + (i * (BBOX.east - BBOX.west)) / (LON_STEPS - 1)).toFixed(2),
			),
		)
	}

	// Build all coordinate pairs
	const allLats: number[] = []
	const allLngs: number[] = []
	for (const lat of lats) {
		for (const lng of lngs) {
			allLats.push(lat)
			allLngs.push(lng)
		}
	}

	console.log(`Fetching wind data for ${allLats.length} grid points...`)

	// Batch requests — Open-Meteo has URL length limits
	const BATCH = 100
	const results: any[] = []

	for (let i = 0; i < allLats.length; i += BATCH) {
		const bLats = allLats.slice(i, i + BATCH)
		const bLngs = allLngs.slice(i, i + BATCH)

		const url = new URL("https://api.open-meteo.com/v1/forecast")
		url.searchParams.set("latitude", bLats.join(","))
		url.searchParams.set("longitude", bLngs.join(","))
		url.searchParams.set("current", "wind_speed_10m,wind_direction_10m")

		const res = await fetch(url.toString())
		if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`)
		const json = await res.json()
		const batch = Array.isArray(json) ? json : [json]
		results.push(...batch)
		process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(allLats.length / BATCH)}\n`)
		// Rate limit
		if (i + BATCH < allLats.length) await new Promise((r) => setTimeout(r, 1000))
	}

	console.log(`Got ${results.length} wind readings`)

	// Convert speed+direction to U/V components
	const uValues: number[] = []
	const vValues: number[] = []

	for (const r of results) {
		const speed = r.current.wind_speed_10m as number
		const dirDeg = r.current.wind_direction_10m as number
		const dirRad = (dirDeg * Math.PI) / 180
		// Meteorological convention: direction wind comes FROM
		uValues.push(-speed * Math.sin(dirRad))
		vValues.push(-speed * Math.cos(dirRad))
	}

	// Compute ranges
	const uMin = Math.min(...uValues)
	const uMax = Math.max(...uValues)
	const vMin = Math.min(...vValues)
	const vMax = Math.max(...vValues)
	const uRange = uMax - uMin || 1
	const vRange = vMax - vMin || 1

	console.log(`U range: ${uMin.toFixed(1)} to ${uMax.toFixed(1)} m/s`)
	console.log(`V range: ${vMin.toFixed(1)} to ${vMax.toFixed(1)} m/s`)

	// Build pixel data (RGBA) — R=U, G=V, B=0, A=255
	const width = LON_STEPS
	const height = LAT_STEPS
	const pixels = new Uint8Array(width * height * 4)

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x
			const px = idx * 4
			pixels[px] = Math.round(((uValues[idx] - uMin) / uRange) * 255)
			pixels[px + 1] = Math.round(((vValues[idx] - vMin) / vRange) * 255)
			pixels[px + 2] = 0
			pixels[px + 3] = 255
		}
	}

	// Encode as minimal PNG
	const pngBuffer = encodePNG(width, height, pixels)
	const base64 = pngBuffer.toString("base64")

	const windData = {
		image: `data:image/png;base64,${base64}`,
		width,
		height,
		uMin,
		uMax,
		vMin,
		vMax,
		bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
		timestamp: new Date().toISOString(),
	}

	const outPath = join(import.meta.dir, "../public/data/wind.json")
	writeFileSync(outPath, JSON.stringify(windData))
	console.log(`\nWind data written to ${outPath}`)
	console.log(`Grid: ${width}x${height}, PNG: ${Math.round(base64.length / 1024)}KB base64`)
}

function encodePNG(width: number, height: number, rgba: Uint8Array): Buffer {
	const zlib = require("node:zlib")
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // RGBA
	ihdr[10] = 0
	ihdr[11] = 0
	ihdr[12] = 0

	const rawData = Buffer.alloc(height * (1 + width * 4))
	for (let y = 0; y < height; y++) {
		const rowOffset = y * (1 + width * 4)
		rawData[rowOffset] = 0 // filter: None
		for (let x = 0; x < width * 4; x++) {
			rawData[rowOffset + 1 + x] = rgba[y * width * 4 + x]
		}
	}

	const compressed = zlib.deflateSync(rawData)

	return Buffer.concat([
		signature,
		makeChunk("IHDR", ihdr),
		makeChunk("IDAT", compressed),
		makeChunk("IEND", Buffer.alloc(0)),
	])
}

function makeChunk(type: string, data: Buffer): Buffer {
	const typeB = Buffer.from(type, "ascii")
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length, 0)
	const crcData = Buffer.concat([typeB, data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(crcData), 0)
	return Buffer.concat([len, typeB, data, crc])
}

function crc32(buf: Buffer): number {
	let c = 0xffffffff
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i]
		for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
	}
	return (c ^ 0xffffffff) >>> 0
}

main().catch(console.error)
