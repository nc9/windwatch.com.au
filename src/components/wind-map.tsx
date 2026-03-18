import { useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url"
import type { WindFacilityData } from "../lib/types"
import type { WindData } from "../lib/wind-particles"
import { capacityFactorColor } from "../lib/colors"
import { formatMW, formatPercent, regionName } from "../lib/format"

maplibregl.workerUrl = maplibreWorkerUrl

const AUSTRALIA_CENTER: [number, number] = [134, -27]
const AUSTRALIA_ZOOM = 4.5

type Props = {
	facilities: WindFacilityData | null
	windData: WindData | null
}

export function WindMap({ facilities, windData }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)
	const windRendererRef = useRef<any>(null)
	const markersRef = useRef<maplibregl.Marker[]>([])

	useEffect(() => {
		if (!containerRef.current) return

		const map = new maplibregl.Map({
			container: containerRef.current,
			style: {
				version: 8,
				sources: {
					carto: {
						type: "raster",
						tiles: [
							"https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
							"https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
						],
						tileSize: 256,
						attribution: "&copy; CartoDB &copy; OSM contributors",
					},
				},
				layers: [{ id: "carto", type: "raster", source: "carto" }],
			},
			center: AUSTRALIA_CENTER,
			zoom: AUSTRALIA_ZOOM,
			minZoom: 3,
			maxZoom: 12,
			maxBounds: [[108, -47], [157, -8]],
		})

		map.addControl(new maplibregl.NavigationControl(), "bottom-right")
		mapRef.current = map

		return () => {
			if (windRendererRef.current) {
				windRendererRef.current.destroy()
				windRendererRef.current = null
			}
			for (const m of markersRef.current) m.remove()
			markersRef.current = []
			map.remove()
			mapRef.current = null
		}
	}, [])

	// Wind particles
	useEffect(() => {
		const map = mapRef.current
		if (!map || !windData) return

		const init = async () => {
			const { WindParticleRenderer } = await import("../lib/wind-particles")
			if (windRendererRef.current) windRendererRef.current.destroy()
			const renderer = new WindParticleRenderer(map)
			await renderer.setWindData(windData)
			renderer.start()
			windRendererRef.current = renderer
		}

		if (map.isStyleLoaded()) init()
		else map.once("style.load", init)
	}, [windData])

	// Facility markers
	useEffect(() => {
		const map = mapRef.current
		if (!map || !facilities) return

		for (const m of markersRef.current) m.remove()
		markersRef.current = []

		for (const f of facilities.facilities) {
			if (!f.lat || !f.lng) continue

			const color = capacityFactorColor(f.capacityFactor)
			const active = f.active && f.currentPower > 0
			const size = Math.max(8, Math.min(28, 6 + Math.sqrt(f.totalCapacity) * 0.5))

			const el = createMarkerElement(size, color, active)

			const popup = new maplibregl.Popup({
				closeButton: true,
				maxWidth: "260px",
				offset: size / 2 + 4,
			}).setHTML(buildPopupHTML(f))

			const marker = new maplibregl.Marker({ element: el, anchor: "center" })
				.setLngLat([f.lng, f.lat])
				.setPopup(popup)
				.addTo(map)

			markersRef.current.push(marker)
		}
	}, [facilities])

	return <div ref={containerRef} className="h-full w-full" />
}

function createMarkerElement(size: number, color: string, active: boolean): HTMLDivElement {
	// Outer wrapper — MapLibre controls its transform, so we don't touch it
	const el = document.createElement("div")
	el.style.cssText = `cursor:pointer;`

	// Inner dot — safe to transform for hover
	const dot = document.createElement("div")
	dot.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:1px solid ${active ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)"};transition:transform 0.15s,box-shadow 0.15s;${active ? `box-shadow:0 0 ${size * 0.5}px ${color}50;` : ""}`
	el.appendChild(dot)

	el.addEventListener("mouseenter", () => {
		dot.style.transform = "scale(1.3)"
		dot.style.boxShadow = `0 0 12px ${color}`
	})
	el.addEventListener("mouseleave", () => {
		dot.style.transform = ""
		dot.style.boxShadow = active ? `0 0 ${size * 0.5}px ${color}50` : ""
	})

	return el
}

function buildPopupHTML(f: WindFacilityData["facilities"][0]): string {
	const cfColor = capacityFactorColor(f.capacityFactor)
	const cf = f.capacityFactor

	return [
		`<div style="font-family:-apple-system,system-ui,sans-serif;color:#f5f5f5;font-size:13px;min-width:200px;">`,
		`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">`,
		`<div style="width:10px;height:10px;border-radius:50%;background:${cfColor};flex-shrink:0;"></div>`,
		`<a href="https://explore.openelectricity.org.au/facility/${encodeURIComponent(f.code)}" target="_blank" rel="noopener" `,
		`style="color:#93c5fd;text-decoration:none;font-size:14px;font-weight:600;line-height:1.2;">`,
		`${f.name}</a></div>`,
		`<div style="color:#9ca3af;font-size:11px;margin-bottom:10px;padding-left:18px;">`,
		`${regionName(f.region)} &middot; ${f.units.length} unit${f.units.length !== 1 ? "s" : ""}</div>`,
		`<div style="display:grid;grid-template-columns:1fr auto;gap:2px 12px;font-size:12px;padding-left:18px;">`,
		`<span style="color:#9ca3af;">Output</span>`,
		`<span style="text-align:right;font-weight:500;">${f.active ? formatMW(f.currentPower) : "Offline"}</span>`,
		`<span style="color:#9ca3af;">Capacity</span>`,
		`<span style="text-align:right;">${formatMW(f.totalCapacity)}</span></div>`,
		`<div style="margin-top:10px;padding-left:18px;">`,
		`<div style="background:#1f2937;border-radius:6px;height:8px;overflow:hidden;">`,
		`<div style="background:${cfColor};width:${Math.max(1, Math.min(100, cf))}%;height:100%;border-radius:6px;"></div></div>`,
		`<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:#6b7280;">`,
		`<span>Capacity factor</span>`,
		`<span style="color:#d1d5db;font-weight:600;">${formatPercent(cf)}</span></div></div></div>`,
	].join("")
}
