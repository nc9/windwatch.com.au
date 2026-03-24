/**
 * Night overlay — semi-transparent dark mask over nighttime areas of Australia.
 * Rendered as a MapLibre image source layer (same pattern as solar-renderer heatmap).
 */

import { sunElevation } from "./sun-position"

const CANVAS_W = 100
const CANVAS_H = 75
const BBOX: [number, number, number, number] = [105, -48, 160, -5]
const UPDATE_INTERVAL = 60_000

export class NightOverlay {
	private map: any
	private intervalId: ReturnType<typeof setInterval> | null = null
	private sourceAdded = false

	constructor(map: any) {
		this.map = map
	}

	init() {
		if (this.map.isStyleLoaded()) {
			this.addLayer()
		} else {
			this.map.once("style.load", () => this.addLayer())
		}
		this.intervalId = setInterval(() => this.update(), UPDATE_INTERVAL)
	}

	private addLayer() {
		const dataUrl = this.renderNightMask()
		const [west, south, east, north] = BBOX

		// HMR cleanup
		try {
			if (this.map.getLayer("night-overlay")) {
				this.map.removeLayer("night-overlay")
			}
			if (this.map.getSource("night-overlay")) {
				this.map.removeSource("night-overlay")
			}
		} catch {}

		// Insert below labels
		const { layers } = this.map.getStyle()
		let insertBefore: string | undefined
		for (const layer of layers) {
			if (layer.type === "symbol") {
				insertBefore = layer.id
				break
			}
		}

		this.map.addSource("night-overlay", {
			coordinates: [
				[west, north],
				[east, north],
				[east, south],
				[west, south],
			],
			type: "image",
			url: dataUrl,
		})

		this.map.addLayer(
			{
				id: "night-overlay",
				paint: { "raster-fade-duration": 0, "raster-opacity": 1 },
				source: "night-overlay",
				type: "raster",
			},
			insertBefore
		)

		this.sourceAdded = true
		this.fixLayerOrder()
	}

	/** Ensure solar-heatmap renders below night-overlay */
	private fixLayerOrder() {
		try {
			if (
				this.map.getLayer("solar-heatmap") &&
				this.map.getLayer("night-overlay")
			) {
				this.map.moveLayer("solar-heatmap", "night-overlay")
			}
		} catch {}
	}

	private renderNightMask(): string {
		const canvas = document.createElement("canvas")
		canvas.width = CANVAS_W
		canvas.height = CANVAS_H
		const ctx = canvas.getContext("2d")!
		const imgData = ctx.createImageData(CANVAS_W, CANVAS_H)
		const { data } = imgData
		const now = new Date()
		const [west, south, east, north] = BBOX

		for (let y = 0; y < CANVAS_H; y++) {
			const lat = north + (south - north) * (y / (CANVAS_H - 1))
			for (let x = 0; x < CANVAS_W; x++) {
				const lng = west + (east - west) * (x / (CANVAS_W - 1))
				const el = sunElevation(lat, lng, now)
				const px = (y * CANVAS_W + x) * 4

				data[px] = 0
				data[px + 1] = 0
				data[px + 2] = 0

				if (el >= 0) {
					data[px + 3] = 0 // day: transparent
				} else if (el >= -6) {
					data[px + 3] = 64 // civil twilight: ~25%
				} else {
					data[px + 3] = 128 // night: ~50%
				}
			}
		}

		ctx.putImageData(imgData, 0, 0)
		return canvas.toDataURL()
	}

	update() {
		if (!this.sourceAdded) {
			return
		}
		const source = this.map.getSource("night-overlay") as any
		if (!source) {
			return
		}

		const dataUrl = this.renderNightMask()
		const [west, south, east, north] = BBOX
		source.updateImage({
			coordinates: [
				[west, north],
				[east, north],
				[east, south],
				[west, south],
			],
			url: dataUrl,
		})
		this.fixLayerOrder()
	}

	destroy() {
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = null
		}
		if (this.sourceAdded) {
			try {
				this.map.removeLayer("night-overlay")
				this.map.removeSource("night-overlay")
			} catch {}
			this.sourceAdded = false
		}
	}
}
