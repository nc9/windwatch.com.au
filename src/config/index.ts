export interface SiteConfig {
	mode: "wind" | "solar"
	title: string
	subtitle: string
	description: string
	favicon: string
	facilitiesUrl: string
	fieldUrl: string
	fieldRefetchInterval: number
	historyUrl: string
	loadingText: string
}

import { solarConfig } from "./solar"
import { windConfig } from "./wind"

const mode = import.meta.env.VITE_MODE ?? "wind"

export const siteConfig: SiteConfig =
	mode === "solar" ? solarConfig : windConfig
