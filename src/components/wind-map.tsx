import { useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url"
import type { WindFacilityData } from "../lib/types"
import type { WindData } from "../lib/wind-particles"
import { capacityFactorExpression } from "../lib/colors"
import { formatMW, formatPercent, regionName } from "../lib/format"
import { capacityFactorColor } from "../lib/colors"

// Fix MapLibre worker for Vite — use CSP worker with ?url import
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

	// Create map once
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

		// Popup on click
		map.on("click", "facilities-circle", (e) => {
			const feature = e.features?.[0]
			if (!feature || feature.geometry.type !== "Point") return
			const coords = feature.geometry.coordinates.slice() as [number, number]
			const p = feature.properties as Record<string, unknown>
			new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
				.setLngLat(coords)
				.setHTML(buildPopup(p))
				.addTo(map)
		})
		map.on("mouseenter", "facilities-circle", () => {
			map.getCanvas().style.cursor = "pointer"
		})
		map.on("mouseleave", "facilities-circle", () => {
			map.getCanvas().style.cursor = ""
		})

		return () => {
			if (windRendererRef.current) {
				windRendererRef.current.destroy()
				windRendererRef.current = null
			}
			map.remove()
			mapRef.current = null
		}
	}, [])

	// Wind particle animation
	useEffect(() => {
		const map = mapRef.current
		if (!map || !windData) return

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

		if (map.isStyleLoaded()) {
			init()
		} else {
			map.once("style.load", init)
		}
	}, [windData])

	// Add/update facility markers
	useEffect(() => {
		const map = mapRef.current
		if (!map || !facilities) return

		const add = () => addFacilities(map, facilities)

		if (map.isStyleLoaded()) {
			add()
		} else {
			map.once("style.load", add)
		}
	}, [facilities])

	return <div ref={containerRef} className="h-full w-full" />
}

function addFacilities(map: maplibregl.Map, data: WindFacilityData) {
	if (map.getLayer("facilities-label")) map.removeLayer("facilities-label")
	if (map.getLayer("facilities-circle")) map.removeLayer("facilities-circle")
	if (map.getSource("facilities")) map.removeSource("facilities")

	const geojson: GeoJSON.FeatureCollection = {
		type: "FeatureCollection",
		features: data.facilities
			.filter((f) => f.lat && f.lng)
			.map((f) => ({
				type: "Feature" as const,
				geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
				properties: {
					code: f.code,
					name: f.name,
					region: f.region,
					totalCapacity: f.totalCapacity,
					currentPower: f.currentPower,
					capacityFactor: f.capacityFactor,
					active: f.active,
					unitCount: f.units.length,
				},
			})),
	}

	map.addSource("facilities", { type: "geojson", data: geojson })

	map.addLayer({
		id: "facilities-circle",
		type: "circle",
		source: "facilities",
		paint: {
			"circle-radius": [
				"interpolate",
				["linear"],
				["get", "totalCapacity"],
				10, 6, 100, 9, 500, 15, 1000, 22,
			],
			"circle-color": capacityFactorExpression() as any,
			"circle-stroke-color": "#ffffff",
			"circle-stroke-width": 1.5,
			"circle-opacity": 0.85,
		},
	})

	map.addLayer({
		id: "facilities-label",
		type: "symbol",
		source: "facilities",
		layout: {
			"text-field": ["get", "name"],
			"text-size": 11,
			"text-offset": [0, 1.5],
			"text-anchor": "top",
			"text-optional": true,
		},
		paint: {
			"text-color": "#d4d4d4",
			"text-halo-color": "#0a0a0a",
			"text-halo-width": 1.5,
		},
		minzoom: 7,
	})
}

function buildPopup(p: Record<string, unknown>): string {
	const name = p.name as string
	const code = p.code as string
	const region = p.region as string
	const totalCapacity = p.totalCapacity as number
	const currentPower = p.currentPower as number
	const cf = p.capacityFactor as number
	const active = p.active as boolean
	const unitCount = p.unitCount as number
	const cfColor = capacityFactorColor(cf)

	return `
		<div style="font-family: system-ui, sans-serif; color: #e5e5e5; font-size: 13px;">
			<div style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">
				<a href="https://explore.openelectricity.org.au/facility/${code}" target="_blank" rel="noopener"
					style="color: #60a5fa; text-decoration: none;">${name}</a>
			</div>
			<div style="color: #a3a3a3; margin-bottom: 8px;">
				${regionName(region)} &middot; ${unitCount} unit${unitCount !== 1 ? "s" : ""}
			</div>
			<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
				<span>Generation</span>
				<span style="font-weight: 600;">${active ? formatMW(currentPower) : "Offline"}</span>
			</div>
			<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
				<span>Capacity</span>
				<span>${formatMW(totalCapacity)}</span>
			</div>
			<div style="margin-top: 6px;">
				<div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
					<span>Capacity Factor</span>
					<span style="font-weight: 600;">${formatPercent(cf)}</span>
				</div>
				<div style="background: #262626; border-radius: 4px; height: 6px; overflow: hidden;">
					<div style="background: ${cfColor}; width: ${Math.max(2, Math.min(100, cf))}%; height: 100%; border-radius: 4px;"></div>
				</div>
			</div>
		</div>
	`
}
