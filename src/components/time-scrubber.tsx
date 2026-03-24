import { useCallback, useEffect, useMemo, useRef, useState } from "react"

interface Props {
	earliest: number
	latest: number
	selectedTime: number | null
	onTimeChange: (ts: number | null) => void
	isLoading: boolean
}

const RANGES = [
	{ label: "6h", ms: 6 * 3_600_000 },
	{ label: "24h", ms: 24 * 3_600_000 },
	{ label: "3d", ms: 3 * 86_400_000 },
	{ label: "7d", ms: 7 * 86_400_000 },
] as const

const HOUR = 3_600_000
const DAY = 86_400_000

const TZ = "Australia/Brisbane"

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString("en-AU", {
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		month: "short",
		timeZone: TZ,
	})
}

function formatShort(ts: number): string {
	return new Date(ts).toLocaleTimeString("en-AU", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: TZ,
	})
}

function formatTickLabel(ts: number, major: boolean): string {
	if (major) {
		return new Date(ts).toLocaleDateString("en-AU", {
			day: "numeric",
			month: "short",
			timeZone: TZ,
		})
	}
	return new Date(ts).toLocaleTimeString("en-AU", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: TZ,
	})
}

/** Determine tick interval based on visible range */
function getTickConfig(rangeMs: number): {
	minor: number
	major: number
} {
	if (rangeMs <= 8 * HOUR) return { minor: HOUR, major: 3 * HOUR }
	if (rangeMs <= 26 * HOUR) return { minor: HOUR, major: 6 * HOUR }
	if (rangeMs <= 4 * DAY) return { minor: 3 * HOUR, major: 12 * HOUR }
	return { minor: 6 * HOUR, major: DAY }
}

export function TimeScrubber({
	earliest,
	latest,
	selectedTime,
	onTimeChange,
	isLoading,
}: Props) {
	const trackRef = useRef<HTMLDivElement>(null)
	const [rangeMs, setRangeMs] = useState(24 * 3_600_000)
	const [dragging, setDragging] = useState(false)
	const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

	const isLive = selectedTime === null
	const rangeEnd = latest
	const rangeStart = Math.max(earliest, rangeEnd - rangeMs)
	const currentTs = selectedTime ?? latest
	const visibleRange = rangeEnd - rangeStart

	const positionToTs = useCallback(
		(clientX: number) => {
			const track = trackRef.current
			if (!track) return latest
			const rect = track.getBoundingClientRect()
			const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
			return Math.round(rangeStart + pct * (rangeEnd - rangeStart))
		},
		[rangeStart, rangeEnd, latest],
	)

	const pct =
		visibleRange > 0
			? ((currentTs - rangeStart) / visibleRange) * 100
			: 100

	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault()
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)
			setDragging(true)
			const ts = positionToTs(e.clientX)
			onTimeChange(ts)
		},
		[positionToTs, onTimeChange],
	)

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!dragging) return
			const ts = positionToTs(e.clientX)
			if (debounceRef.current) clearTimeout(debounceRef.current)
			debounceRef.current = setTimeout(() => onTimeChange(ts), 100)
		},
		[dragging, positionToTs, onTimeChange],
	)

	const handlePointerUp = useCallback(() => {
		setDragging(false)
	}, [])

	// Arrow keys
	useEffect(() => {
		const step = 300_000 // 5 min
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "ArrowLeft") {
				onTimeChange(Math.max(earliest, (selectedTime ?? latest) - step))
			} else if (e.key === "ArrowRight") {
				const next = (selectedTime ?? latest) + step
				if (next >= latest) {
					onTimeChange(null)
				} else {
					onTimeChange(next)
				}
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [earliest, latest, selectedTime, onTimeChange])

	// Build ticks with major/minor distinction
	const tickConfig = useMemo(() => getTickConfig(visibleRange), [visibleRange])

	const ticks = useMemo(() => {
		const result: { ts: number; pctLeft: number; isMajor: boolean }[] = []
		// Generate minor ticks
		const firstMinor =
			Math.ceil(rangeStart / tickConfig.minor) * tickConfig.minor
		for (let t = firstMinor; t <= rangeEnd; t += tickConfig.minor) {
			const isMajor = t % tickConfig.major === 0
			const left = ((t - rangeStart) / visibleRange) * 100
			if (left >= 0 && left <= 100) {
				result.push({ ts: t, pctLeft: left, isMajor })
			}
		}
		return result
	}, [rangeStart, rangeEnd, visibleRange, tickConfig])

	// Filter labels to avoid overlapping — only show labels that are spaced apart enough
	const labelledTicks = useMemo(() => {
		const majorTicks = ticks.filter((t) => t.isMajor)
		if (majorTicks.length === 0) return []
		// Minimum spacing between labels in % of track width
		const minSpacing = 8
		const result: typeof majorTicks = []
		let lastPct = -minSpacing
		for (const tick of majorTicks) {
			if (tick.pctLeft - lastPct >= minSpacing && tick.pctLeft > 2 && tick.pctLeft < 98) {
				result.push(tick)
				lastPct = tick.pctLeft
			}
		}
		return result
	}, [ticks])

	return (
		<div className="pointer-events-auto absolute right-0 bottom-0 left-0 z-20 flex flex-col border-t border-neutral-700/80 bg-neutral-950/95 backdrop-blur-md">
			{/* Track area */}
			<div className="flex items-center gap-3 px-4 pt-2.5 pb-0.5">
				{/* Range presets */}
				<div className="flex gap-1">
					{RANGES.map((r) => (
						<button
							key={r.label}
							type="button"
							onClick={() => setRangeMs(r.ms)}
							className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
								rangeMs === r.ms
									? "bg-neutral-700 text-white"
									: "text-neutral-500 hover:text-neutral-300"
							}`}
						>
							{r.label}
						</button>
					))}
				</div>

				{/* Track */}
				<div
					ref={trackRef}
					className="relative h-10 flex-1 cursor-pointer touch-none select-none"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
				>
					{/* Rail */}
					<div className="absolute top-[40%] right-0 left-0 h-[3px] -translate-y-1/2 rounded-full bg-neutral-700/80" />

					{/* Filled portion up to thumb */}
					<div
						className="absolute top-[40%] left-0 h-[3px] -translate-y-1/2 rounded-full"
						style={{
							width: `${Math.max(0, Math.min(100, pct))}%`,
							background: isLive
								? "linear-gradient(to right, rgba(34,197,94,0.15), rgba(34,197,94,0.4))"
								: "linear-gradient(to right, rgba(251,191,36,0.15), rgba(251,191,36,0.4))",
						}}
					/>

					{/* Ticks */}
					{ticks.map((tick) => (
						<div
							key={tick.ts}
							className={`absolute top-[40%] -translate-y-1/2 ${
								tick.isMajor
									? "h-4 w-[2px] bg-neutral-400"
									: "h-2.5 w-px bg-neutral-600"
							}`}
							style={{ left: `${tick.pctLeft}%` }}
						/>
					))}

					{/* Tick labels — below the rail */}
					{labelledTicks.map((tick) => (
						<span
							key={`label-${tick.ts}`}
							className="absolute top-[62%] -translate-x-1/2 text-[10px] tabular-nums text-neutral-400"
							style={{ left: `${tick.pctLeft}%` }}
						>
							{formatTickLabel(tick.ts, visibleRange > 2 * DAY)}
						</span>
					))}

					{/* Start / end boundary labels */}
					<span className="absolute top-[62%] left-0 text-[10px] tabular-nums text-neutral-500">
						{formatShort(rangeStart)}
					</span>
					<span className="absolute top-[62%] right-0 text-right text-[10px] tabular-nums text-neutral-500">
						{formatShort(rangeEnd)}
					</span>

					{/* Thumb */}
					<div
						className="absolute top-[40%] -translate-x-1/2 -translate-y-1/2"
						style={{ left: `${Math.max(0, Math.min(100, pct))}%` }}
					>
						<div
							className={`h-5 w-5 rounded-full border-2 shadow-lg ${
								isLive
									? "border-green-400 bg-green-500 shadow-green-500/30"
									: "border-amber-400 bg-amber-500 shadow-amber-500/30"
							} ${isLoading ? "animate-pulse" : ""}`}
						/>
					</div>
				</div>

				{/* Current time display */}
				<span className="w-36 text-right text-xs tabular-nums text-neutral-300">
					{isLive ? formatShort(latest) : formatTime(currentTs)}
				</span>

				{/* Live button */}
				<button
					type="button"
					onClick={() => onTimeChange(null)}
					className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
						isLive
							? "bg-green-900/50 text-green-400"
							: "text-neutral-500 hover:text-white"
					}`}
				>
					<span
						className={`inline-block h-2 w-2 rounded-full ${
							isLive ? "bg-green-400" : "bg-neutral-600"
						}`}
					/>
					LIVE
				</button>
			</div>
		</div>
	)
}
