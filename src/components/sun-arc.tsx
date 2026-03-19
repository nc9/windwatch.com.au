import { useEffect, useState } from "react"

import { sunProgress, sunTimes } from "../lib/sun-position"

/** Central Australia solar belt reference point */
const REF_LAT = -32
const REF_LNG = 140

const W = 200
const H = 80
const CX = W / 2
const CY = H - 10
const R = 80
const DOT_R = 5

function formatAEST(date: Date): string {
	return date.toLocaleTimeString("en-AU", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "Australia/Brisbane",
	})
}

export function SunArc() {
	const [now, setNow] = useState(() => new Date())

	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 60_000)
		return () => clearInterval(id)
	}, [])

	const { sunrise, sunset } = sunTimes(REF_LAT, REF_LNG, now)
	const progress = sunProgress(REF_LAT, REF_LNG, now)
	const isDaytime = progress > 0 && progress < 1

	// Sun position on semicircle arc (left=sunrise, right=sunset)
	const angle = Math.PI - progress * Math.PI
	const sx = CX + R * Math.cos(angle)
	const sy = CY - R * Math.sin(angle)

	// Arc path: semicircle from left to right
	const arcStart = `${CX - R},${CY}`
	const arcEnd = `${CX + R},${CY}`

	return (
		<div className="mt-2 border-t border-neutral-800 pt-2">
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full">
				{/* Horizon line */}
				<line
					x1={CX - R - 10}
					y1={CY}
					x2={CX + R + 10}
					y2={CY}
					stroke="#404040"
					strokeWidth={0.5}
				/>

				{/* Arc path */}
				<path
					d={`M ${arcStart} A ${R} ${R} 0 0 1 ${arcEnd}`}
					fill="none"
					stroke="#525252"
					strokeWidth={1}
					strokeDasharray="4 3"
				/>

				{/* Sun dot — visible only during daytime */}
				{isDaytime && <circle cx={sx} cy={sy} r={DOT_R} fill="#fbbf24" />}

				{/* Sunrise label */}
				<text
					x={CX - R}
					y={CY + 12}
					textAnchor="middle"
					fill="#9ca3af"
					fontSize={9}
				>
					{formatAEST(sunrise)}
				</text>

				{/* Sunset label */}
				<text
					x={CX + R}
					y={CY + 12}
					textAnchor="middle"
					fill="#9ca3af"
					fontSize={9}
				>
					{formatAEST(sunset)}
				</text>
			</svg>
		</div>
	)
}
