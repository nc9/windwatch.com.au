const REGION_NAMES: Record<string, string> = {
	NSW1: "New South Wales",
	QLD1: "Queensland",
	SA1: "South Australia",
	TAS1: "Tasmania",
	VIC1: "Victoria",
	WA1: "Western Australia",
}

export function regionName(code: string): string {
	return REGION_NAMES[code] ?? code
}

export function formatMW(mw: number): string {
	if (mw >= 1000) {
		return `${(mw / 1000).toFixed(1)} GW`
	}
	return `${Math.round(mw)} MW`
}

export function formatPercent(value: number): string {
	return `${Math.round(value)}%`
}
