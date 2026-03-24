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
const FIELD_HISTORY_URL =
	import.meta.env.VITE_FIELD_HISTORY_URL || "/api/history/field"

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

	// Historical field data — round to nearest hour (KV granularity) to reduce API calls
	const fieldHistoryHour = selectedTime
		? Math.round(selectedTime / 3_600_000) * 3_600_000
		: null
	const historicalField = useQuery<FieldData>({
		queryFn: () =>
			fetch(
				`${FIELD_HISTORY_URL}?type=${siteConfig.mode}&at=${fieldHistoryHour}`,
			).then((r) => {
				if (!r.ok) throw new Error(`field history ${r.status}`)
				return r.json()
			}),
		enabled: !isLive && fieldHistoryHour !== null,
		queryKey: ["field-history", fieldHistoryHour],
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})

	// Derive historical facility data from snapshot
	const historicalFacilities = useMemo<FacilityData | null>(() => {
		if (isLive || !history.data?.meta || !history.data?.snapshots.length)
			return null
		const snap = findClosestSnapshot(history.data.snapshots, selectedTime!)
		if (!snap) return null
		return mergeSnapshot(history.data.meta, snap)
	}, [isLive, selectedTime, history.data])

	// Timeline bounds — show immediately with estimated range, refine when data loads
	const timelineBounds = useMemo(() => {
		const snaps = history.data?.snapshots
		if (snaps?.length) {
			return {
				earliest: snaps[0].ts,
				latest: snaps[snaps.length - 1].ts,
			}
		}
		// Estimated bounds while loading
		const now = Date.now()
		return { earliest: now - 7 * 86_400_000, latest: now }
	}, [history.data])

	// Resolve active data
	const facilities = isLive
		? (liveFacilities.data ?? null)
		: historicalFacilities
	const fieldData = isLive
		? (liveField.data ?? null)
		: (historicalField.data ?? liveField.data ?? null)

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
			<TimeScrubber
				earliest={timelineBounds.earliest}
				latest={timelineBounds.latest}
				selectedTime={selectedTime}
				onTimeChange={setSelectedTime}
				isLoading={history.isLoading}
			/>
		</div>
	)
}
