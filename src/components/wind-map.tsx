import maplibregl from "maplibre-gl"
import { useEffect, useRef, useState } from "react"

import { capacityFactorColor, capacityFactorExpression } from "../lib/colors"
import { formatMW, formatPercent, regionName } from "../lib/format"
import type { WindFacilityData } from "../lib/types"
import type { WindData } from "../lib/wind-particles"

const AUSTRALIA_CENTER: [number, number] = [134, -27]
const AUSTRALIA_ZOOM = 4.5

interface Props {
	facilities: WindFacilityData | null
	windData: WindData | null
}

export function WindMap({ facilities, windData }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)
	const windRendererRef = useRef<any>(null)
	const popupRef = useRef<maplibregl.Popup | null>(null)
	const [windGrid, setWindGrid] = useState<ImageData | null>(null)

	// Decode wind PNG once when windData arrives
	useEffect(() => {
		if (!windData) {
			return
		}
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
		if (!containerRef.current) {
			return
		}

		const map = new maplibregl.Map({
			center: AUSTRALIA_CENTER,
			container: containerRef.current,
			maxBounds: [
				[108, -47],
				[157, -8],
			],
			maxZoom: 12,
			minZoom: 3,
			style:
				"https://api.protomaps.com/styles/v5/grayscale/en.json?key=fa8e7fa44153e559",
			zoom: AUSTRALIA_ZOOM,
		})

		map.addControl(new maplibregl.NavigationControl(), "bottom-right")
		mapRef.current = map

		return () => {
			if (windRendererRef.current) {
				windRendererRef.current.destroy()
				windRendererRef.current = null
			}
			popupRef.current?.remove()
			map.remove()
			mapRef.current = null
		}
	}, [])

	// Wind particles — init once map and wind data are both ready
	useEffect(() => {
		const map = mapRef.current
		if (!map || !windData) {
			return
		}

		// Simple direct init — no cancelled flag complexity
		const init = async () => {
			const { WindParticleRenderer } = await import("../lib/wind-particles")
			if (windRendererRef.current) {
				windRendererRef.current.destroy()
			}
			const renderer = new WindParticleRenderer(map)
			await renderer.setWindData(windData)
			renderer.start()
			windRendererRef.current = renderer
		}

		init()
	}, [windData])

	// Facility circles as MapLibre layer (renders below labels)
	useEffect(() => {
		const map = mapRef.current
		if (!map || !facilities) {
			return
		}

		const addFacilities = () => {
			const geojson: GeoJSON.FeatureCollection = {
				features: facilities.facilities
					.filter((f) => f.lat && f.lng)
					.map((f) => ({
						geometry: { coordinates: [f.lng, f.lat], type: "Point" },
						properties: {
							active: f.active && f.currentPower > 0,
							capacityFactor: f.capacityFactor,
							code: f.code,
							currentPower: f.currentPower,
							name: f.name,
							region: f.region,
							totalCapacity: f.totalCapacity,
							units: f.units.length,
						},
						type: "Feature",
					})),
				type: "FeatureCollection",
			}

			// Clean up previous
			try {
				if (map.getLayer("facilities")) {
					map.removeLayer("facilities")
				}
				if (map.getLayer("facilities-stroke")) {
					map.removeLayer("facilities-stroke")
				}
				if (map.getSource("facilities")) {
					map.removeSource("facilities")
				}
			} catch {}

			map.addSource("facilities", { data: geojson, type: "geojson" })

			// Find first symbol layer to insert below labels
			const { layers } = map.getStyle()
			let labelLayerId: string | undefined
			for (const layer of layers) {
				if (layer.type === "symbol") {
					labelLayerId = layer.id
					break
				}
			}

			// Stroke layer (dark outline)
			map.addLayer(
				{
					id: "facilities-stroke",
					paint: {
						"circle-color": "rgba(0,0,0,0.4)",
						"circle-radius": [
							"interpolate",
							["linear"],
							["get", "totalCapacity"],
							10,
							5,
							100,
							7,
							500,
							10,
							1500,
							14,
						],
						"circle-translate": [0, 0],
					},
					source: "facilities",
					type: "circle",
				},
				labelLayerId
			)

			// Fill layer
			map.addLayer(
				{
					id: "facilities",
					paint: {
						"circle-color": capacityFactorExpression() as any,
						"circle-radius": [
							"interpolate",
							["linear"],
							["get", "totalCapacity"],
							10,
							4,
							100,
							6,
							500,
							9,
							1500,
							13,
						],
						"circle-stroke-color": "rgba(0,0,0,0.3)",
						"circle-stroke-width": 1.5,
					},
					source: "facilities",
					type: "circle",
				},
				labelLayerId
			)

			// Pointer cursor
			map.on("mouseenter", "facilities", () => {
				map.getCanvas().style.cursor = "pointer"
			})
			map.on("mouseleave", "facilities", () => {
				map.getCanvas().style.cursor = ""
			})

			// Click popup
			map.on("click", "facilities", (e) => {
				const feat = e.features?.[0]
				if (!feat || feat.geometry.type !== "Point") {
					return
				}
				const props = feat.properties
				const f = facilities.facilities.find((fac) => fac.code === props.code)
				if (!f) {
					return
				}

				const localWind =
					windData && windGrid
						? getWindAt(windData, windGrid, f.lng, f.lat)
						: null

				popupRef.current?.remove()
				popupRef.current = new maplibregl.Popup({
					closeButton: true,
					maxWidth: "260px",
					offset: 10,
				})
					.setLngLat([f.lng, f.lat])
					.setHTML(buildPopupHTML(f, localWind))
					.addTo(map)
			})
		}

		if (map.isStyleLoaded()) {
			addFacilities()
		} else {
			map.once("style.load", addFacilities)
		}
	}, [facilities, windData, windGrid])

	return <div ref={containerRef} className="h-full w-full" />
}

interface LocalWind {
	speed: number
	direction: number
	cardinal: string
}

function getWindAt(
	wd: WindData,
	grid: ImageData,
	lng: number,
	lat: number
): LocalWind | null {
	const [west, south, east, north] = wd.bbox
	if (lng < west || lng > east || lat < south || lat > north) {
		return null
	}

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

	const u =
		u00 * (1 - fx) * (1 - fy) +
		u10 * fx * (1 - fy) +
		u01 * (1 - fx) * fy +
		u11 * fx * fy
	const v =
		v00 * (1 - fx) * (1 - fy) +
		v10 * fx * (1 - fy) +
		v01 * (1 - fx) * fy +
		v11 * fx * fy

	const speed = Math.sqrt(u * u + v * v)
	const dirRad = Math.atan2(-u, -v)
	const direction = ((dirRad * 180) / Math.PI + 360) % 360

	const cardinals = [
		"N",
		"NNE",
		"NE",
		"ENE",
		"E",
		"ESE",
		"SE",
		"SSE",
		"S",
		"SSW",
		"SW",
		"WSW",
		"W",
		"WNW",
		"NW",
		"NNW",
	]
	const cardinal = cardinals[Math.round(direction / 22.5) % 16]

	return { cardinal, direction, speed }
}

function buildPopupHTML(
	f: WindFacilityData["facilities"][0],
	wind: LocalWind | null
): string {
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
