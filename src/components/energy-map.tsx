import maplibregl from "maplibre-gl"
import { useEffect, useRef, useState } from "react"

import { siteConfig } from "../config"
import { capacityFactorColor, capacityFactorExpression } from "../lib/colors"
import { formatMW, formatPercent, formatWm2, regionName } from "../lib/format"
import { NightOverlay } from "../lib/night-overlay"
import type {
	FacilityData,
	FieldData,
	FieldRenderer,
	SolarFieldData,
	WindFieldData,
} from "../lib/types"

const AUSTRALIA_CENTER: [number, number] = [134, -27]
const AUSTRALIA_ZOOM = 4.5

interface Props {
	facilities: FacilityData | null
	fieldData: FieldData | null
}

export function EnergyMap({ facilities, fieldData }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)
	const rendererRef = useRef<FieldRenderer | null>(null)
	const popupRef = useRef<maplibregl.Popup | null>(null)
	const [fieldGrid, setFieldGrid] = useState<ImageData | null>(null)

	// Decode field PNG once when fieldData arrives
	useEffect(() => {
		if (!fieldData) {
			return
		}
		const img = new Image()
		img.onload = () => {
			const c = document.createElement("canvas")
			c.width = fieldData.width
			c.height = fieldData.height
			const ctx = c.getContext("2d")!
			ctx.drawImage(img, 0, 0)
			setFieldGrid(ctx.getImageData(0, 0, fieldData.width, fieldData.height))
		}
		img.src = fieldData.image
	}, [fieldData])

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
				"https://api.protomaps.com/styles/v5/dark/en.json?key=fa8e7fa44153e559",
			zoom: AUSTRALIA_ZOOM,
		})

		map.addControl(new maplibregl.NavigationControl(), "bottom-right")
		mapRef.current = map

		return () => {
			if (rendererRef.current) {
				rendererRef.current.destroy()
				rendererRef.current = null
			}
			popupRef.current?.remove()
			map.remove()
			mapRef.current = null
		}
	}, [])

	// Field renderer — init once map and field data are both ready
	useEffect(() => {
		const map = mapRef.current
		if (!map || !fieldData) {
			return
		}

		const init = async () => {
			rendererRef.current?.destroy()

			if (siteConfig.mode === "wind") {
				const { WindParticleRenderer } = await import("../lib/wind-particles")
				const renderer = new WindParticleRenderer(map)
				await renderer.setData(fieldData)
				renderer.start()
				rendererRef.current = renderer
			} else {
				const { SolarRenderer } = await import("../lib/solar-renderer")
				const renderer = new SolarRenderer(map)
				await renderer.setData(fieldData)
				renderer.start()
				rendererRef.current = renderer
			}
		}

		init()
	}, [fieldData])

	// Night overlay — solar mode only (above heatmap, below facilities)
	useEffect(() => {
		const map = mapRef.current
		if (!map || !fieldData || siteConfig.mode !== "solar") {
			return
		}
		const overlay = new NightOverlay(map)
		overlay.init()
		return () => overlay.destroy()
	}, [fieldData])

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
						"circle-color": capacityFactorExpression(siteConfig.mode) as any,
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

				let fieldInfo: LocalWind | LocalSolar | null = null
				if (fieldData && fieldGrid) {
					if (siteConfig.mode === "wind") {
						fieldInfo = getWindAt(
							fieldData as WindFieldData,
							fieldGrid,
							f.lng,
							f.lat
						)
					} else {
						fieldInfo = getSolarAt(
							fieldData as SolarFieldData,
							fieldGrid,
							f.lng,
							f.lat
						)
					}
				}

				popupRef.current?.remove()
				popupRef.current = new maplibregl.Popup({
					closeButton: true,
					maxWidth: "260px",
					offset: 10,
				})
					.setLngLat([f.lng, f.lat])
					.setHTML(buildPopupHTML(f, fieldInfo))
					.addTo(map)
			})
		}

		if (map.isStyleLoaded()) {
			addFacilities()
		} else {
			map.once("style.load", addFacilities)
		}
	}, [facilities, fieldData, fieldGrid])

	return <div ref={containerRef} className="h-full w-full" />
}

// --- Field lookup types ---

interface LocalWind {
	type: "wind"
	speed: number
	direction: number
	cardinal: string
}

interface LocalSolar {
	type: "solar"
	irradiance: number
	cloudCover: number
}

// --- Bilinear interpolation helpers ---

function getWindAt(
	wd: WindFieldData,
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

	return { cardinal, direction, speed, type: "wind" }
}

function getSolarAt(
	sd: SolarFieldData,
	grid: ImageData,
	lng: number,
	lat: number
): LocalSolar | null {
	const [west, south, east, north] = sd.bbox
	if (lng < west || lng > east || lat < south || lat > north) {
		return null
	}

	const gx = ((lng - west) / (east - west)) * (sd.width - 1)
	const gy = ((north - lat) / (north - south)) * (sd.height - 1)
	const x0 = Math.floor(gx)
	const y0 = Math.floor(gy)
	const x1 = Math.min(x0 + 1, sd.width - 1)
	const y1 = Math.min(y0 + 1, sd.height - 1)
	const fx = gx - x0
	const fy = gy - y0

	const pix = (x: number, y: number): [number, number] => {
		const i = (y * sd.width + x) * 4
		return [grid.data[i], grid.data[i + 1]]
	}

	const [r00, g00] = pix(x0, y0)
	const [r10, g10] = pix(x1, y0)
	const [r01, g01] = pix(x0, y1)
	const [r11, g11] = pix(x1, y1)

	const r =
		r00 * (1 - fx) * (1 - fy) +
		r10 * fx * (1 - fy) +
		r01 * (1 - fx) * fy +
		r11 * fx * fy
	const g =
		g00 * (1 - fx) * (1 - fy) +
		g10 * fx * (1 - fy) +
		g01 * (1 - fx) * fy +
		g11 * fx * fy

	return {
		cloudCover: (g / 255) * 100,
		irradiance: (r / 255) * 1200,
		type: "solar",
	}
}

// --- Popup HTML builder ---

function buildPopupHTML(
	f: FacilityData["facilities"][0],
	fieldInfo: LocalWind | LocalSolar | null
): string {
	const cfColor = capacityFactorColor(f.capacityFactor, siteConfig.mode)
	const cf = f.capacityFactor

	let fieldRow = ""

	if (fieldInfo?.type === "wind") {
		const windArrow =
			`<svg viewBox="0 0 24 24" width="14" height="14" style="transform:rotate(${fieldInfo.direction + 180}deg);flex-shrink:0;">` +
			`<path d="M12 2l0 18M12 2l-4 6M12 2l4 6" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`

		fieldRow =
			`<span style="color:#9ca3af;">Wind</span>` +
			`<span style="text-align:right;display:flex;align-items:center;gap:4px;justify-content:flex-end;">` +
			`${windArrow} ${fieldInfo.speed.toFixed(1)} m/s ${fieldInfo.cardinal}</span>`
	} else if (fieldInfo?.type === "solar") {
		fieldRow =
			`<span style="color:#9ca3af;">Irradiance</span>` +
			`<span style="text-align:right;">${formatWm2(fieldInfo.irradiance)}</span>` +
			`<span style="color:#9ca3af;">Cloud Cover</span>` +
			`<span style="text-align:right;">${formatPercent(fieldInfo.cloudCover)}</span>`
	}

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
		fieldRow,
		`</div>`,
		`<div style="margin-top:10px;padding-left:18px;">`,
		`<div style="background:#1f2937;border-radius:6px;height:8px;overflow:hidden;">`,
		`<div style="background:${cfColor};width:${Math.max(1, Math.min(100, cf))}%;height:100%;border-radius:6px;"></div></div>`,
		`<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:#6b7280;">`,
		`<span>Capacity factor</span>`,
		`<span style="color:#d1d5db;font-weight:600;">${formatPercent(cf)}</span></div></div></div>`,
	].join("")
}
