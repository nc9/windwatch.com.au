import { ImageResponse } from "@vercel/og"

import { getKV } from "./lib/kv"
import { OG_BG } from "./lib/og-bg"

const CACHE = "public, s-maxage=300, stale-while-revalidate=600"
const MAX_AGE_MS = 3 * 3_600_000
const KV_TIMEOUT_MS = 3000

// Design tokens mirrored from src/components/stats-panel.tsx (tailwind neutral scale)
const C = {
	border: "#262626",
	muted: "#a3a3a3",
	panel: "rgba(10, 10, 10, 0.9)",
	subtle: "#737373",
	text: "#ffffff",
}

interface Stats {
	acf: number
	facilities: number
	gw: number
	ts: number
}

async function readStats(): Promise<Stats | null> {
	try {
		const kv = getKV()
		const raw = await Promise.race([
			kv.zrange("ts:wind:facilities", -1, -1),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("kv timeout")), KV_TIMEOUT_MS)
			),
		])
		const last = raw?.[0]
		if (!last) return null
		const s = typeof last === "string" ? JSON.parse(last) : (last as any)
		const facilities = Object.keys(s.f ?? {}).length
		if (
			![s.t, s.acf, s.ts].every(
				(n) => typeof n === "number" && Number.isFinite(n)
			) ||
			facilities === 0 ||
			Date.now() - s.ts > MAX_AGE_MS
		) {
			return null
		}
		return { acf: s.acf, facilities, gw: s.t / 1000, ts: s.ts }
	} catch (error) {
		console.error("og: KV read failed", error)
		return null
	}
}

function fmtTime(ts: number) {
	return `${new Date(ts).toLocaleTimeString("en-AU", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "Australia/Brisbane",
	})} AEST`
}

function Stat({
	label,
	value,
	big,
}: {
	label: string
	value: string
	big?: boolean
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
			<div style={{ color: C.muted, fontSize: 22 }}>{label}</div>
			<div style={{ color: C.text, fontSize: big ? 60 : 44, lineHeight: 1.1 }}>
				{value}
			</div>
		</div>
	)
}

function Card({ stats }: { stats: Stats | null }) {
	return (
		<div
			style={{
				background: C.panel,
				border: `1px solid ${C.border}`,
				borderRadius: 20,
				display: "flex",
				flexDirection: "column",
				left: 48,
				padding: 32,
				position: "absolute",
				top: 48,
				width: 540,
			}}
		>
			<div style={{ color: C.text, fontSize: 42 }}>Wind Watch Australia</div>
			<div style={{ color: C.muted, fontSize: 24, marginTop: 8 }}>
				Real-time wind farm generation
			</div>
			{stats ? (
				<div style={{ display: "flex", flexDirection: "column" }}>
					<Stat
						big
						label="Total Generation"
						value={`${stats.gw.toFixed(2)} GW`}
					/>
					<Stat label="Capacity Factor" value={`${stats.acf.toFixed(1)}%`} />
					<Stat label="Facilities" value={String(stats.facilities)} />
					<div
						style={{
							borderTop: `1px solid ${C.border}`,
							color: C.subtle,
							fontSize: 22,
							marginTop: 20,
							paddingTop: 14,
						}}
					>
						{`Updated ${fmtTime(stats.ts)}`}
					</div>
				</div>
			) : (
				<div style={{ color: C.muted, fontSize: 28, marginTop: 28 }}>
					Live map of NEM and WEM wind farms with an animated wind field
				</div>
			)}
		</div>
	)
}

export async function GET(_request: Request) {
	const stats = await readStats()
	try {
		const img = new ImageResponse(
			<div style={{ display: "flex", height: "100%", width: "100%" }}>
				<img
					alt=""
					height={630}
					src={OG_BG}
					style={{ position: "absolute" }}
					width={1200}
				/>
				<Card stats={stats} />
			</div>,
			{ height: 630, width: 1200 }
		)
		// ImageResponse appends its own immutable 1y Cache-Control; replace it
		return new Response(img.body, {
			headers: { "Cache-Control": CACHE, "Content-Type": "image/png" },
		})
	} catch (error) {
		console.error("og: render failed", error)
		return new Response("og render failed", {
			headers: { "Cache-Control": "public, s-maxage=60" },
			status: 500,
		})
	}
}
