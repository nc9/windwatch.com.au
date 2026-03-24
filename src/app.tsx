import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { EnergyMap } from "./components/energy-map"
import { Legend } from "./components/legend"
import { StatsPanel } from "./components/stats-panel"
import { TimeScrubber } from "./components/time-scrubber"
import { siteConfig } from "./config"
import { fetchHistory, findClosestSnapshot, mergeSnapshot } from "./lib/history"
import type { FacilityData, FieldData } from "./lib/types"

const FACILITIES_URL =
	import.meta.env.VITE_FACILITIES_URL || siteConfig.facilitiesUrl
const FIELD_URL = import.meta.env.VITE_FIELD_URL || siteConfig.fieldUrl
const HISTORY_URL =
	import.meta.env.VITE_HISTORY_URL || siteConfig.historyUrl

const fetchJSON = (url: string) =>
	fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json())

export function App() {
	const [selectedTime, setSelectedTime] = useState<number | null>(null)
	const isLive = selectedTime === null

	// Live data
	const liveFacilities = useQuery<FacilityData>({
		queryFn: () => fetchJSON(FACILITIES_URL),
		queryKey: ["facilities"],
		refetchInterval: 5 * 60_000,
	})

	const liveField = useQuery<FieldData>({
		queryFn: () => fetchJSON(FIELD_URL),
		queryKey: ["field"],
		refetchInterval: siteConfig.fieldRefetchInterval,
	})

	// History data (single file with all snapshots)
	const history = useQuery({
		queryFn: () => fetchHistory(HISTORY_URL),
		queryKey: ["history", siteConfig.mode],
		staleTime: 5 * 60_000,
	})

	// Derive historical facility data from snapshot
	const historicalFacilities = useMemo<FacilityData | null>(() => {
		if (isLive || !history.data?.meta || !history.data?.snapshots.length)
			return null
		const snap = findClosestSnapshot(history.data.snapshots, selectedTime!)
		if (!snap) return null
		return mergeSnapshot(history.data.meta, snap)
	}, [isLive, selectedTime, history.data])

	// Timeline bounds
	const timelineBounds = useMemo(() => {
		const snaps = history.data?.snapshots
		if (!snaps?.length) return null
		return {
			earliest: snaps[0].ts,
			latest: snaps[snaps.length - 1].ts,
		}
	}, [history.data])

	// Resolve active data
	const facilities = isLive
		? (liveFacilities.data ?? null)
		: historicalFacilities
	const fieldData = liveField.data ?? null

	return (
		<div className="relative h-screen w-screen bg-neutral-950">
			<EnergyMap facilities={facilities} fieldData={fieldData} />
			<StatsPanel
				data={facilities}
				error={
					liveFacilities.error ? String(liveFacilities.error) : null
				}
				isLive={isLive}
			/>
			<Legend />
			{timelineBounds && (
				<TimeScrubber
					earliest={timelineBounds.earliest}
					latest={timelineBounds.latest}
					selectedTime={selectedTime}
					onTimeChange={setSelectedTime}
					isLoading={false}
				/>
			)}
		</div>
	)
}
