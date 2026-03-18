/**
 * Capacity factor color scale for wind:
 * 0% = red (offline), ~3% = white (low), ~10% = lime, ~25% = green, 40%+ = dark green
 */

const CF_STOPS: Array<[number, [number, number, number]]> = [
	[0, [255, 255, 255]],   // white — off/barely running
	[10, [190, 242, 100]],  // lime — generating
	[20, [74, 222, 128]],   // green — decent
	[30, [22, 163, 74]],    // green — good
	[40, [21, 128, 61]],    // dark green — great
]

export function capacityFactorColor(cf: number): string {
	const v = Math.max(0, cf)

	// Find the two stops to interpolate between
	for (let i = 1; i < CF_STOPS.length; i++) {
		if (v <= CF_STOPS[i][0]) {
			const [lo, colA] = CF_STOPS[i - 1]
			const [hi, colB] = CF_STOPS[i]
			const t = (v - lo) / (hi - lo)
			const r = Math.round(colA[0] + (colB[0] - colA[0]) * t)
			const g = Math.round(colA[1] + (colB[1] - colA[1]) * t)
			const b = Math.round(colA[2] + (colB[2] - colA[2]) * t)
			return `rgb(${r},${g},${b})`
		}
	}

	// Above max stop — dark green
	const last = CF_STOPS[CF_STOPS.length - 1][1]
	return `rgb(${last[0]},${last[1]},${last[2]})`
}

/**
 * MapLibre interpolate expression for circle-color paint property.
 */
export function capacityFactorExpression(): unknown[] {
	return [
		"interpolate",
		["linear"],
		["get", "capacityFactor"],
		0, "#ffffff",
		10, "#bef264",
		20, "#4ade80",
		30, "#16a34a",
		40, "#15803d",
	]
}
