/**
 * Interpolate capacity factor (0-100) to a color.
 * 0% = red, 50% = yellow, 100% = green
 */
export function capacityFactorColor(cf: number): string {
	const t = Math.max(0, Math.min(100, cf)) / 100

	let r: number
	let g: number
	const b = 30

	if (t < 0.5) {
		// red → yellow
		const s = t / 0.5
		r = 220
		g = Math.round(40 + s * 180)
	} else {
		// yellow → green
		const s = (t - 0.5) / 0.5
		r = Math.round(220 - s * 186)
		g = Math.round(220 - s * 23)
	}

	return `rgb(${r},${g},${b})`
}

/**
 * Returns a MapLibre interpolate expression for capacity factor coloring.
 * Used in circle-color paint property.
 */
export function capacityFactorExpression(): unknown[] {
	return [
		"interpolate",
		["linear"],
		["get", "capacityFactor"],
		0,
		"#dc2626",
		25,
		"#ea580c",
		50,
		"#eab308",
		75,
		"#65a30d",
		100,
		"#22c55e",
	]
}
