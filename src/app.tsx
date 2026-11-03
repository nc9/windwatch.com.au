import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useMemo, useState } from "react"

import { EnergyMap } from "./components/energy-map"
import { Legend } from "./components/legend"
import { StatsPanel } from "./components/stats-panel"
import { TimeScrubber } from "./components/time-scrubber"
import { siteConfig } from "./config"
import { fetchHistory, findClosestSnapshot, mergeSnapshot } from "./lib/history"
import type { FacilityData, FieldData } from "./lib/types"
import { readUrlState, writeUrlState } from "./lib/url-state"
import { useShortcuts } from "./lib/use-shortcuts"

const ShortcutsModal = lazy(() =>
	import("./components/shortcuts-modal").then((m) => ({
		default: m.ShortcutsModal,
	}))
)

const FACILITIES_URL =
	import.meta.env.VITE_FACILITIES_URL || siteConfig.facilitiesUrl
const FIELD_URL = import.meta.env.VITE_FIELD_URL || siteConfig.fieldUrl
const HISTORY_URL = import.meta.env.VITE_HISTORY_URL || siteConfig.historyUrl
const FIELD_HISTORY_URL =
	import.meta.env.VITE_FIELD_HISTORY_URL || "/api/history/field"

const fetchJSON = (url: string) =>
	fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json())

export function App() {
	// Time + range live in the URL so a snapshot can be shared
	const [initialState] = useState(readUrlState)
	const [selectedTime, setSelectedTime] = useState<number | null>(
		initialState.time
	)
	const [rangeMs, setRangeMs] = useState(initialState.rangeMs)
	const [helpOpen, setHelpOpen] = useState(false)
	const isLive = selectedTime === null

	useEffect(() => {
		writeUrlState({ rangeMs, time: selectedTime })
	}, [selectedTime, rangeMs])

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
		refetchInterval: 5 * 60_000,
		staleTime: 4 * 60_000,
	})

	// Historical field data — round to nearest hour (KV granularity) to reduce API calls
	const fieldHistoryHour = selectedTime
		? Math.round(selectedTime / 3_600_000) * 3_600_000
		: null
	const historicalField = useQuery<FieldData>({
		queryFn: () =>
			fetch(
				`${FIELD_HISTORY_URL}?type=${siteConfig.mode}&at=${fieldHistoryHour}`
			).then((r) => {
				if (!r.ok) {
					throw new Error(`field history ${r.status}`)
				}
				return r.json()
			}),
		enabled: !isLive && fieldHistoryHour !== null,
		// Hold the previous hour's field while the next loads, instead of
		// snapping back to the live wind
		placeholderData: keepPreviousData,
		queryKey: ["field-history", fieldHistoryHour],
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})

	// Derive historical facility data from snapshot
	const historicalFacilities = useMemo<FacilityData | null>(() => {
		if (isLive || !history.data?.meta || !history.data?.snapshots.length) {
			return null
		}
		const snap = findClosestSnapshot(history.data.snapshots, selectedTime!)
		if (!snap) {
			return null
		}
		return mergeSnapshot(history.data.meta, snap)
	}, [isLive, selectedTime, history.data])

	// Timeline bounds — use live facilities timestamp when in LIVE mode so the
	// scrubber advances as new data arrives instead of staying stuck at the last
	// history snapshot.
	const liveTs = liveFacilities.data?.lastUpdated
		? new Date(liveFacilities.data.lastUpdated).getTime()
		: null
	const timelineBounds = useMemo(() => {
		const snaps = history.data?.snapshots
		const historyLatest = snaps?.length ? snaps.at(-1).ts : null
		const historyEarliest = snaps?.length ? snaps[0].ts : null

		// latest = most recent of live data or history snapshots
		const latest = Math.max(liveTs ?? 0, historyLatest ?? 0) || Date.now()
		const earliest = historyEarliest ?? latest - 7 * 86_400_000

		return { earliest, latest }
	}, [history.data, liveTs])

	// Resolve active data
	const facilities = isLive
		? (liveFacilities.data ?? null)
		: historicalFacilities
	const fieldData = isLive
		? (liveField.data ?? null)
		: (historicalField.data ?? liveField.data ?? null)

	useShortcuts({
		earliest: timelineBounds.earliest,
		helpOpen,
		latest: timelineBounds.latest,
		onHelpChange: setHelpOpen,
		onRangeChange: setRangeMs,
		onTimeChange: setSelectedTime,
		rangeMs,
		selectedTime,
	})

	return (
		<div className="relative h-screen w-screen bg-neutral-950">
			<a
				href="#main"
				className="sr-only z-40 rounded bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:outline-2 focus-visible:outline-neutral-400"
			>
				Skip to map
			</a>
			<main id="main" className="absolute inset-0">
				<EnergyMap facilities={facilities} fieldData={fieldData} />
				<StatsPanel
					data={facilities}
					error={liveFacilities.error ? String(liveFacilities.error) : null}
					isLive={isLive}
				/>
				<Legend />
				<TimeScrubber
					earliest={timelineBounds.earliest}
					latest={timelineBounds.latest}
					selectedTime={selectedTime}
					onTimeChange={setSelectedTime}
					rangeMs={rangeMs}
					onRangeChange={setRangeMs}
					isLoading={history.isLoading}
				/>
				<button
					type="button"
					onClick={() => setHelpOpen(true)}
					aria-label="? keyboard shortcuts"
					className="absolute top-4 right-4 z-20 h-8 w-8 rounded-full border border-neutral-700 bg-neutral-950/90 text-sm font-medium text-neutral-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-neutral-400"
				>
					?
				</button>
			</main>
			{helpOpen && (
				<Suspense fallback={null}>
					<ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
				</Suspense>
			)}
		</div>
	)
}
