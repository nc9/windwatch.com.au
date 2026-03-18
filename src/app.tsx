import { useEffect, useState } from "react"
import type { WindFacilityData } from "./lib/types"
import type { WindData } from "./lib/wind-particles"
import { WindMap } from "./components/wind-map"
import { StatsPanel } from "./components/stats-panel"
import { Legend } from "./components/legend"

export function App() {
	const [facilities, setFacilities] = useState<WindFacilityData | null>(null)
	const [windData, setWindData] = useState<WindData | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		fetch("/data/facilities.json")
			.then((r) => r.json())
			.then(setFacilities)
			.catch((e) => setError(String(e)))

		fetch("/data/wind.json")
			.then((r) => r.json())
			.then(setWindData)
			.catch((e) => console.error("Wind data load error:", e))
	}, [])

	return (
		<div className="relative h-screen w-screen bg-neutral-950">
			<WindMap facilities={facilities} windData={windData} />
			<StatsPanel data={facilities} error={error} />
			<Legend />
		</div>
	)
}
