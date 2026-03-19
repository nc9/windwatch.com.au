/**
 * Fetch solar irradiance + cloud cover from Open-Meteo and generate solar texture PNG.
 * Run with: bun run scripts/generate-solar.ts
 * Outputs to public/data/solar.json
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const BBOX = { east: 160, north: -5, south: -48, west: 105 }
const LON_STEPS = 20
const LAT_STEPS = 15
const MAX_IRRADIANCE = 1200

async function main() {
	// Build grid points
	const lats: number[] = []
	const lngs: number[] = []
	for (let i = 0; i < LAT_STEPS; i++) {
		lats.push(
			Number(
				(
					BBOX.north +
					(i * (BBOX.south - BBOX.north)) / (LAT_STEPS - 1)
				).toFixed(2)
			)
		)
	}
	for (let i = 0; i < LON_STEPS; i++) {
		lngs.push(
			Number(
				(BBOX.west + (i * (BBOX.east - BBOX.west)) / (LON_STEPS - 1)).toFixed(2)
			)
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

	console.log(`Fetching solar data for ${allLats.length} grid points...`)

	// Batch requests
	const BATCH = 100
	const results: any[] = []

	for (let i = 0; i < allLats.length; i += BATCH) {
		const bLats = allLats.slice(i, i + BATCH)
		const bLngs = allLngs.slice(i, i + BATCH)

		const url = new URL("https://api.open-meteo.com/v1/forecast")
		url.searchParams.set("latitude", bLats.join(","))
		url.searchParams.set("longitude", bLngs.join(","))
		url.searchParams.set("current", "shortwave_radiation,cloud_cover")

		const res = await fetch(url.toString())
		if (!res.ok) {
			throw new Error(`Open-Meteo error: ${res.status}`)
		}
		const json = await res.json()
		const batch = Array.isArray(json) ? json : [json]
		results.push(...batch)
		process.stdout.write(
			`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(allLats.length / BATCH)}\n`
		)
		if (i + BATCH < allLats.length) {
			await new Promise((r) => setTimeout(r, 1000))
		}
	}

	console.log(`Got ${results.length} solar readings`)

	// Extract values
	const irradianceValues: number[] = []
	const cloudCoverValues: number[] = []
	for (const r of results) {
		irradianceValues.push(r.current.shortwave_radiation as number)
		cloudCoverValues.push(r.current.cloud_cover as number)
	}

	const maxIrr = Math.max(...irradianceValues)
	const avgCloud = (
		cloudCoverValues.reduce((a, b) => a + b, 0) / cloudCoverValues.length
	).toFixed(1)
	console.log(`Max irradiance: ${maxIrr} W/m², avg cloud cover: ${avgCloud}%`)

	// Build pixel data: R=irradiance, G=cloud_cover
	const width = LON_STEPS
	const height = LAT_STEPS
	const pixels = new Uint8Array(width * height * 4)

	for (let i = 0; i < results.length; i++) {
		const px = i * 4
		pixels[px] = Math.round(
			Math.min(irradianceValues[i] / MAX_IRRADIANCE, 1) * 255
		)
		pixels[px + 1] = Math.round(Math.min(cloudCoverValues[i] / 100, 1) * 255)
		pixels[px + 2] = 0
		pixels[px + 3] = 255
	}

	// Encode as minimal PNG
	const pngBuffer = encodePNG(width, height, pixels)
	const base64 = pngBuffer.toString("base64")

	const solarData = {
		bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
		height,
		image: `data:image/png;base64,${base64}`,
		timestamp: new Date().toISOString(),
		width,
	}

	const outPath = join(import.meta.dir, "../public/data/solar.json")
	writeFileSync(outPath, JSON.stringify(solarData))
	console.log(`\nSolar data written to ${outPath}`)
	console.log(
		`Grid: ${width}x${height}, PNG: ${Math.round(base64.length / 1024)}KB base64`
	)
}

function encodePNG(width: number, height: number, rgba: Uint8Array): Buffer {
	const zlib = require("node:zlib")
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8
	ihdr[9] = 6
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
	let c = 0xFF_FF_FF_FF
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i]
		for (let j = 0; j < 8; j++) {
			c = c & 1 ? (c >>> 1) ^ 0xED_B8_83_20 : c >>> 1
		}
	}
	return (c ^ 0xFF_FF_FF_FF) >>> 0
}

main().catch(console.error)
