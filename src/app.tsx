import { useQuery } from "@tanstack/react-query"

import { EnergyMap } from "./components/energy-map"
import { Legend } from "./components/legend"
import { StatsPanel } from "./components/stats-panel"
import { siteConfig } from "./config"
import type { FacilityData, FieldData } from "./lib/types"

const FACILITIES_URL =
	import.meta.env.VITE_FACILITIES_URL || siteConfig.facilitiesUrl
const FIELD_URL = import.meta.env.VITE_FIELD_URL || siteConfig.fieldUrl

/** Fetch with cache-busting to bypass Vercel Blob CDN cache */
const fetchJSON = (url: string) =>
	fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json())

export function App() {
	const facilities = useQuery<FacilityData>({
		queryFn: () => fetchJSON(FACILITIES_URL),
		queryKey: ["facilities"],
	})

	const field = useQuery<FieldData>({
		queryFn: () => fetchJSON(FIELD_URL),
		queryKey: ["field"],
		refetchInterval: siteConfig.fieldRefetchInterval,
	})

	return (
		<div className="relative h-screen w-screen bg-neutral-950">
			<EnergyMap
				facilities={facilities.data ?? null}
				fieldData={field.data ?? null}
			/>
			<StatsPanel
				data={facilities.data ?? null}
				error={facilities.error ? String(facilities.error) : null}
			/>
			<Legend />
		</div>
	)
}
