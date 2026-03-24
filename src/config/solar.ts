import type { SiteConfig } from "./index"

export const solarConfig: SiteConfig = {
	description:
		"Real-time solar farm generation and irradiance across Australia",
	facilitiesUrl: "/data/solar_utility-facilities.json",
	historyUrl: "/data/history-solar_utility.json",
	favicon: "\u2600\uFE0F",
	fieldRefetchInterval: 60 * 60 * 1000, // 1h
	fieldUrl: "/data/solar.json",
	loadingText: "Loading solar data...",
	mode: "solar",
	subtitle: "Real-time solar farm generation",
	title: "Solar Watch Australia",
}
