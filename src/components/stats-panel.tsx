import { formatMW, formatPercent } from "../lib/format"
import type { WindFacilityData } from "../lib/types"

interface Props {
	data: WindFacilityData | null
	error?: string | null
}

export function StatsPanel({ data, error }: Props) {
	return (
		<div className="pointer-events-auto absolute top-4 left-4 z-10 max-w-xs rounded-xl border border-neutral-800 bg-neutral-950/90 p-4 shadow-lg backdrop-blur-sm">
			<h1 className="mb-1 text-lg font-bold text-white">
				Wind Watch Australia
			</h1>
			<p className="mb-3 text-xs text-neutral-400">
				Real-time wind farm generation
			</p>

			{error ? (
				<div className="text-sm text-red-400">{error}</div>
			) : (data ? (
				<div className="space-y-2 text-sm">
					<StatRow
						label="Total Generation"
						value={formatMW(data.totalPower)}
						highlight
					/>
					<StatRow
						label="Total Capacity"
						value={formatMW(data.totalCapacity)}
					/>
					<StatRow
						label="Capacity Factor"
						value={formatPercent(data.aggregateCapacityFactor)}
					/>
					<StatRow label="Facilities" value={String(data.facilities.length)} />
					<div className="border-t border-neutral-800 pt-2 text-xs text-neutral-500">
						Updated{" "}
						{new Date(data.lastUpdated).toLocaleTimeString("en-AU", {
							hour: "2-digit",
							minute: "2-digit",
							timeZone: "Australia/Brisbane",
						})}{" "}
						AEST
					</div>
				</div>
			) : (
				<div className="text-sm text-neutral-500">Loading wind data...</div>
			))}
		</div>
	)
}

function StatRow({
	label,
	value,
	highlight,
}: {
	label: string
	value: string
	highlight?: boolean
}) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-neutral-400">{label}</span>
			<span
				className={highlight ? "font-semibold text-white" : "text-neutral-200"}
			>
				{value}
			</span>
		</div>
	)
}
