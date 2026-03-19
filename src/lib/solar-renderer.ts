/**
 * Solar irradiance heatmap renderer.
 * Renders irradiance as a colored heatmap with cloud cover modulating brightness.
 * No particle animation — static heatmap only.
 */

import { irradianceColor } from "./colors"
import type { FieldData, FieldRenderer, SolarFieldData } from "./types"

export class SolarRenderer implements FieldRenderer {
	private map: any
	private solarData: SolarFieldData | null = null
	private solarImage: ImageData | null = null
	private heatmapSourceAdded = false

	constructor(map: any) {
		this.map = map
	}

	/** Wait for map style to be ready, handling the case where style.load already fired */
	private waitForMap(cb: () => void) {
		if (this.map.isStyleLoaded()) {
			cb()
		} else {
			// style.load may not re-fire after layer removal; use idle as fallback
			const onReady = () => {
				this.map.off("idle", onReady)
				this.map.off("style.load", onReady)
				cb()
			}
			this.map.once("style.load", onReady)
			this.map.once("idle", onReady)
		}
	}

	async setData(data: FieldData) {
		const sd = data as SolarFieldData
		this.solarData = sd

		const img = new Image()
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve()
			img.onerror = reject
			img.src = sd.image
		})

		const c = document.createElement("canvas")
		c.width = sd.width
		c.height = sd.height
		const ctx = c.getContext("2d")!
		ctx.drawImage(img, 0, 0)
		this.solarImage = ctx.getImageData(0, 0, sd.width, sd.height)

		this.waitForMap(() => this.buildHeatmap())
		this.map.on("moveend", () => this.updateHeatmap())
		this.map.on("zoomend", () => this.updateHeatmap())
	}

	private buildHeatmap() {
		if (!this.solarData || !this.solarImage) {
			return
		}

		const dataUrl = this.renderHeatmapImage()
		const [west, south, east, north] = this.solarData.bbox
		const coords: [
			[number, number],
			[number, number],
			[number, number],
			[number, number],
		] = [
			[west, north],
			[east, north],
			[east, south],
			[west, south],
		]

		// Clean up existing source/layer from HMR
		try {
			if (this.map.getLayer("solar-heatmap")) {
				this.map.removeLayer("solar-heatmap")
			}
			if (this.map.getSource("solar-heatmap")) {
				this.map.removeSource("solar-heatmap")
			}
		} catch {}

		// Insert heatmap below labels but above everything else
		const { layers } = this.map.getStyle()
		let insertBefore: string | undefined
		for (const layer of layers) {
			if (layer.type === "symbol") {
				insertBefore = layer.id
				break
			}
		}

		this.map.addSource("solar-heatmap", {
			coordinates: coords,
			type: "image",
			url: dataUrl,
		})

		this.map.addLayer(
			{
				id: "solar-heatmap",
				paint: { "raster-fade-duration": 0, "raster-opacity": 0.6 },
				source: "solar-heatmap",
				type: "raster",
			},
			insertBefore
		)

		this.heatmapSourceAdded = true
	}

	private updateHeatmap() {
		if (!this.heatmapSourceAdded || !this.solarData || !this.solarImage) {
			return
		}
		const source = this.map.getSource("solar-heatmap") as any
		if (!source) {
			return
		}

		const dataUrl = this.renderHeatmapImage()
		const [west, south, east, north] = this.solarData.bbox
		source.updateImage({
			coordinates: [
				[west, north],
				[east, north],
				[east, south],
				[west, south],
			],
			url: dataUrl,
		})
	}

	/** Render irradiance grid to offscreen canvas, return data URL */
	private renderHeatmapImage(): string {
		const sd = this.solarData!
		const si = this.solarImage!
		const { width, height } = sd

		const offscreen = document.createElement("canvas")
		offscreen.width = width
		offscreen.height = height
		const ctx = offscreen.getContext("2d")!
		const imgData = ctx.createImageData(width, height)
		const { data } = imgData

		for (let i = 0; i < width * height; i++) {
			const px = i * 4
			const irradiance = (si.data[px] / 255) * 1200
			const cloudCover = si.data[px + 1] / 255 // 0-1

			const [r, g, b] = irradianceColor(irradiance)

			// Cloud cover dims brightness (clear=full, overcast=60%)
			const brightness = 1 - cloudCover * 0.4

			data[px] = Math.round(r * brightness)
			data[px + 1] = Math.round(g * brightness)
			data[px + 2] = Math.round(b * brightness)
			data[px + 3] = 255
		}

		ctx.putImageData(imgData, 0, 0)
		return offscreen.toDataURL()
	}

	start() {
		// No animation for solar — heatmap is static
	}

	stop() {
		// No animation to stop
	}

	destroy() {
		if (this.heatmapSourceAdded) {
			try {
				this.map.removeLayer("solar-heatmap")
				this.map.removeSource("solar-heatmap")
			} catch {}
			this.heatmapSourceAdded = false
		}
	}
}
