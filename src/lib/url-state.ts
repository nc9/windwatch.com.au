export const RANGES = [
	{ label: "6h", ms: 6 * 3_600_000 },
	{ label: "24h", ms: 24 * 3_600_000 },
	{ label: "3d", ms: 3 * 86_400_000 },
	{ label: "7d", ms: 7 * 86_400_000 },
] as const

export const DEFAULT_RANGE_MS = 24 * 3_600_000

export interface UrlState {
	/** null = live */
	time: number | null
	rangeMs: number
}

/** Parse `?t=2026-11-03T00:15Z&r=3d`. Anything invalid falls back to live / 24h. */
export function readUrlState(): UrlState {
	const params = new URLSearchParams(window.location.search)

	const rawTime = params.get("t")
	let time: number | null = null
	if (rawTime) {
		const parsed = /^\d{10,}$/.test(rawTime)
			? Number(rawTime)
			: Date.parse(rawTime)
		if (Number.isFinite(parsed) && parsed < Date.now()) {
			time = parsed
		}
	}

	const range = RANGES.find((r) => r.label === params.get("r"))
	return { rangeMs: range?.ms ?? DEFAULT_RANGE_MS, time }
}

/** Mirror state into the URL without adding history entries. Live omits `t`. */
export function writeUrlState({ time, rangeMs }: UrlState): void {
	const params = new URLSearchParams(window.location.search)

	if (time === null) {
		params.delete("t")
	} else {
		params.set("t", new Date(time).toISOString().slice(0, 16) + "Z")
	}

	const range = RANGES.find((r) => r.ms === rangeMs)
	if (!range || rangeMs === DEFAULT_RANGE_MS) {
		params.delete("r")
	} else {
		params.set("r", range.label)
	}

	const query = params.toString()
	const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
	window.history.replaceState(null, "", url)
}
