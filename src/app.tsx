import { useQuery } from "@tanstack/react-query"

import { Legend } from "./components/legend"
import { StatsPanel } from "./components/stats-panel"
import { WindMap } from "./components/wind-map"
import type { WindFacilityData } from "./lib/types"
import type { WindData } from "./lib/wind-particles"

const FACILITIES_URL =
	import.meta.env.VITE_FACILITIES_URL || "/data/facilities.json"
const WIND_URL = import.meta.env.VITE_WIND_URL || "/data/wind.json"

/** Fetch with cache-busting to bypass Vercel Blob CDN cache */
const fetchJSON = (url: string) =>
	fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json())

export function App() {
	const facilities = useQuery<WindFacilityData>({
		queryFn: () => fetchJSON(FACILITIES_URL),
		queryKey: ["facilities"],
	})

	const wind = useQuery<WindData>({
		queryFn: () => fetchJSON(WIND_URL),
		queryKey: ["wind"],
		refetchInterval: 6 * 60 * 60 * 1000,
	})

	return (
		<div className="relative h-screen w-screen bg-neutral-950">
			<WindMap
				facilities={facilities.data ?? null}
				windData={wind.data ?? null}
			/>
			<StatsPanel
				data={facilities.data ?? null}
				error={facilities.error ? String(facilities.error) : null}
			/>
			<Legend />
		</div>
	)
}
