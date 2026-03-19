/**
 * Capacity factor color scale for wind:
 * 0% = white (off), ~10% = lime, ~25% = green, 40%+ = dark green
 */

const CF_WIND_STOPS: [number, [number, number, number]][] = [
	[0, [255, 255, 255]], // white — off/barely running
	[10, [190, 242, 100]], // lime — generating
	[20, [74, 222, 128]], // green — decent
	[30, [22, 163, 74]], // green — good
	[40, [21, 128, 61]], // dark green — great
]

/**
 * Capacity factor color scale for solar:
 * 0% = dark brown (off) → amber → bright yellow (40%+)
 */
const CF_SOLAR_STOPS: [number, [number, number, number]][] = [
	[0, [60, 40, 15]], // dark brown — off
	[10, [140, 90, 20]], // dark amber — low
	[20, [200, 150, 30]], // amber — decent
	[30, [240, 200, 40]], // yellow — good
	[40, [255, 240, 80]], // bright yellow — great
]

function interpolateStops(
	stops: [number, [number, number, number]][],
	v: number
): string {
	const clamped = Math.max(0, v)
	for (let i = 1; i < stops.length; i++) {
		if (clamped <= stops[i][0]) {
			const [lo, colA] = stops[i - 1]
			const [hi, colB] = stops[i]
			const t = (clamped - lo) / (hi - lo)
			const r = Math.round(colA[0] + (colB[0] - colA[0]) * t)
			const g = Math.round(colA[1] + (colB[1] - colA[1]) * t)
			const b = Math.round(colA[2] + (colB[2] - colA[2]) * t)
			return `rgb(${r},${g},${b})`
		}
	}
	const last = stops.at(-1)![1]
	return `rgb(${last[0]},${last[1]},${last[2]})`
}

export function capacityFactorColor(
	cf: number,
	mode?: "wind" | "solar"
): string {
	return interpolateStops(mode === "solar" ? CF_SOLAR_STOPS : CF_WIND_STOPS, cf)
}

/**
 * MapLibre interpolate expression for circle-color paint property.
 */
export function capacityFactorExpression(mode?: "wind" | "solar"): unknown[] {
	if (mode === "solar") {
		return [
			"interpolate",
			["linear"],
			["get", "capacityFactor"],
			0,
			"rgb(60,40,15)",
			10,
			"rgb(140,90,20)",
			20,
			"rgb(200,150,30)",
			30,
			"rgb(240,200,40)",
			40,
			"rgb(255,240,80)",
		]
	}
	return [
		"interpolate",
		["linear"],
		["get", "capacityFactor"],
		0,
		"#ffffff",
		10,
		"#bef264",
		20,
		"#4ade80",
		30,
		"#16a34a",
		40,
		"#15803d",
	]
}

/**
 * Irradiance color scale: dark → purple → orange → yellow → white (0-1200 W/m²)
 */
const IRRADIANCE_STOPS: [number, [number, number, number]][] = [
	[0, [15, 0, 30]], // dark (night)
	[100, [50, 10, 90]], // deep purple
	[200, [90, 20, 140]], // purple
	[400, [170, 50, 100]], // magenta
	[600, [220, 110, 30]], // orange
	[800, [240, 180, 20]], // amber
	[1000, [250, 230, 60]], // yellow
	[1200, [255, 255, 200]], // cream/white
]

export function irradianceColor(wm2: number): [number, number, number] {
	const v = Math.max(0, wm2)

	for (let i = 1; i < IRRADIANCE_STOPS.length; i++) {
		if (v <= IRRADIANCE_STOPS[i][0]) {
			const [lo, colA] = IRRADIANCE_STOPS[i - 1]
			const [hi, colB] = IRRADIANCE_STOPS[i]
			const t = (v - lo) / (hi - lo)
			return [
				Math.round(colA[0] + (colB[0] - colA[0]) * t),
				Math.round(colA[1] + (colB[1] - colA[1]) * t),
				Math.round(colA[2] + (colB[2] - colA[2]) * t),
			]
		}
	}

	const last = IRRADIANCE_STOPS.at(-1)![1]
	return [last[0], last[1], last[2]]
}

export function irradianceExpression(): unknown[] {
	return [
		"interpolate",
		["linear"],
		["get", "irradiance"],
		0,
		"rgb(15,0,30)",
		100,
		"rgb(50,10,90)",
		200,
		"rgb(90,20,140)",
		400,
		"rgb(170,50,100)",
		600,
		"rgb(220,110,30)",
		800,
		"rgb(240,180,20)",
		1000,
		"rgb(250,230,60)",
		1200,
		"rgb(255,255,200)",
	]
}
