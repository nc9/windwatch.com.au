import { useQuery } from "@tanstack/react-query"
import type { WindFacilityData } from "./lib/types"
import type { WindData } from "./lib/wind-particles"
import { WindMap } from "./components/wind-map"
import { StatsPanel } from "./components/stats-panel"
import { Legend } from "./components/legend"

const FACILITIES_URL =
	import.meta.env.VITE_FACILITIES_URL || "/data/facilities.json"
const WIND_URL = import.meta.env.VITE_WIND_URL || "/data/wind.json"

export function App() {
	const facilities = useQuery<WindFacilityData>({
		queryKey: ["facilities"],
		queryFn: () => fetch(FACILITIES_URL).then((r) => r.json()),
	})

	const wind = useQuery<WindData>({
		queryKey: ["wind"],
		queryFn: () => fetch(WIND_URL).then((r) => r.json()),
		refetchInterval: 6 * 60 * 60 * 1000, // wind updates every 6h
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
