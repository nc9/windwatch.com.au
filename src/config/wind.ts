import type { SiteConfig } from "./index"

export const windConfig: SiteConfig = {
	description:
		"Real-time wind farm generation and wind patterns across Australia",
	facilitiesUrl: "/data/wind-facilities.json",
	favicon: "\u{1F4A8}",
	fieldRefetchInterval: 6 * 60 * 60 * 1000, // 6h
	fieldUrl: "/data/wind.json",
	loadingText: "Loading wind data...",
	mode: "wind",
	subtitle: "Real-time wind farm generation",
	title: "Wind Watch Australia",
}
