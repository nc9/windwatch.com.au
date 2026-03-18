import { useEffect, useRef, useState } from "react"
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
	const [windGrid, setWindGrid] = useState<ImageData | null>(null)

	// Decode wind PNG once when windData arrives
	useEffect(() => {
		if (!windData) return
		const img = new Image()
		img.onload = () => {
			const c = document.createElement("canvas")
			c.width = windData.width
			c.height = windData.height
			const ctx = c.getContext("2d")!
			ctx.drawImage(img, 0, 0)
			setWindGrid(ctx.getImageData(0, 0, windData.width, windData.height))
		}
		img.src = windData.image
	}, [windData])

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

	// Wind particles — init once map and wind data are both ready
	useEffect(() => {
		const map = mapRef.current
		if (!map || !windData) return

		// Simple direct init — no cancelled flag complexity
		const init = async () => {
			const { WindParticleRenderer } = await import("../lib/wind-particles")
			if (windRendererRef.current) windRendererRef.current.destroy()
			const renderer = new WindParticleRenderer(map)
			await renderer.setWindData(windData)
			renderer.start()
			windRendererRef.current = renderer
		}

		init()
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
			const localWind = windData && windGrid ? getWindAt(windData, windGrid, f.lng, f.lat) : null

			const el = createMarkerElement(size, color, active)

			const popup = new maplibregl.Popup({
				closeButton: true,
				maxWidth: "260px",
				offset: size / 2 + 4,
			}).setHTML(buildPopupHTML(f, localWind))

			const marker = new maplibregl.Marker({ element: el, anchor: "center" })
				.setLngLat([f.lng, f.lat])
				.setPopup(popup)
				.addTo(map)

			markersRef.current.push(marker)
		}
	}, [facilities, windData, windGrid])

	return <div ref={containerRef} className="h-full w-full" />
}

type LocalWind = { speed: number; direction: number; cardinal: string }

function getWindAt(wd: WindData, grid: ImageData, lng: number, lat: number): LocalWind | null {
	const [west, south, east, north] = wd.bbox
	if (lng < west || lng > east || lat < south || lat > north) return null

	const gx = ((lng - west) / (east - west)) * (wd.width - 1)
	const gy = ((north - lat) / (north - south)) * (wd.height - 1)
	const x0 = Math.floor(gx)
	const y0 = Math.floor(gy)
	const x1 = Math.min(x0 + 1, wd.width - 1)
	const y1 = Math.min(y0 + 1, wd.height - 1)
	const fx = gx - x0
	const fy = gy - y0

	const pix = (x: number, y: number): [number, number] => {
		const i = (y * wd.width + x) * 4
		return [
			wd.uMin + (grid.data[i] / 255) * (wd.uMax - wd.uMin),
			wd.vMin + (grid.data[i + 1] / 255) * (wd.vMax - wd.vMin),
		]
	}

	const [u00, v00] = pix(x0, y0)
	const [u10, v10] = pix(x1, y0)
	const [u01, v01] = pix(x0, y1)
	const [u11, v11] = pix(x1, y1)

	const u = u00 * (1 - fx) * (1 - fy) + u10 * fx * (1 - fy) + u01 * (1 - fx) * fy + u11 * fx * fy
	const v = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy

	const speed = Math.sqrt(u * u + v * v)
	const dirRad = Math.atan2(-u, -v)
	const direction = ((dirRad * 180) / Math.PI + 360) % 360

	const cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
	const cardinal = cardinals[Math.round(direction / 22.5) % 16]

	return { speed, direction, cardinal }
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

function buildPopupHTML(f: WindFacilityData["facilities"][0], wind: LocalWind | null): string {
	const cfColor = capacityFactorColor(f.capacityFactor)
	const cf = f.capacityFactor

	// Wind arrow SVG rotated to direction
	// Arrow points where wind blows TO (direction + 180 from meteorological "from")
	const windArrow = wind
		? `<svg viewBox="0 0 24 24" width="14" height="14" style="transform:rotate(${wind.direction + 180}deg);flex-shrink:0;">` +
		  `<path d="M12 2l0 18M12 2l-4 6M12 2l4 6" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`
		: ""

	const windRow = wind
		? `<span style="color:#9ca3af;">Wind</span>` +
		  `<span style="text-align:right;display:flex;align-items:center;gap:4px;justify-content:flex-end;">` +
		  `${windArrow} ${wind.speed.toFixed(1)} m/s ${wind.cardinal}</span>`
		: ""

	return [
		`<div style="font-family:-apple-system,system-ui,sans-serif;color:#f5f5f5;font-size:13px;min-width:210px;">`,
		`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">`,
		`<div style="width:10px;height:10px;border-radius:50%;background:${cfColor};flex-shrink:0;"></div>`,
		`<a href="https://explore.openelectricity.org.au/facility/${encodeURIComponent(f.code)}" target="_blank" rel="noopener" `,
		`style="color:#93c5fd;text-decoration:none;font-size:14px;font-weight:600;line-height:1.2;">`,
		`${f.name}</a></div>`,
		`<div style="color:#9ca3af;font-size:11px;margin-bottom:10px;padding-left:18px;">`,
		`${regionName(f.region)} &middot; ${f.units.length} unit${f.units.length !== 1 ? "s" : ""}</div>`,
		`<div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:12px;padding-left:18px;">`,
		`<span style="color:#9ca3af;">Output</span>`,
		`<span style="text-align:right;font-weight:500;">${f.active ? formatMW(f.currentPower) : "Offline"}</span>`,
		`<span style="color:#9ca3af;">Capacity</span>`,
		`<span style="text-align:right;">${formatMW(f.totalCapacity)}</span>`,
		windRow,
		`</div>`,
		`<div style="margin-top:10px;padding-left:18px;">`,
		`<div style="background:#1f2937;border-radius:6px;height:8px;overflow:hidden;">`,
		`<div style="background:${cfColor};width:${Math.max(1, Math.min(100, cf))}%;height:100%;border-radius:6px;"></div></div>`,
		`<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:#6b7280;">`,
		`<span>Capacity factor</span>`,
		`<span style="color:#d1d5db;font-weight:600;">${formatPercent(cf)}</span></div></div></div>`,
	].join("")
}
