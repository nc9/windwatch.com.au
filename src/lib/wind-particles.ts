/**
 * Windy.com-style wind particle animation.
 * Particles flow along wind paths with speed-based coloring and smooth trails.
 */

import type { FieldData, FieldRenderer, WindFieldData } from "./types"

interface Particle {
	lng: number
	lat: number
	age: number
	maxAge: number
	trail: { x: number; y: number; speed: number }[]
}

// Wind color scale: deep purple → dark blue → light blue → cyan → green → yellow → red
const SPEED_COLORS = [
	[60, 20, 120], // 0 m/s — deep purple (still)
	[70, 40, 160], // 1 m/s — purple
	[60, 70, 200], // 3 m/s — dark blue
	[80, 130, 240], // 5 m/s — blue
	[100, 160, 255], // 7 m/s — light blue
	[60, 210, 230], // 9 m/s — cyan
	[60, 220, 180], // 11 m/s — teal
	[80, 230, 120], // 13 m/s — green
	[160, 240, 60], // 16 m/s — lime
	[240, 240, 50], // 19 m/s — yellow
	[255, 180, 40], // 22 m/s — orange
	[255, 90, 50], // 26 m/s — red
	[255, 60, 180], // 30+ m/s — hot pink (extreme)
]

export { SPEED_COLORS }

export class WindParticleRenderer implements FieldRenderer {
	private canvas: HTMLCanvasElement
	private ctx: CanvasRenderingContext2D
	private map: any
	private windData: WindFieldData | null = null
	private windImage: ImageData | null = null
	private particles: Particle[] = []
	private animId: number | null = null
	private readonly baseParticleCount = 4000
	private readonly baseZoom = 4.5
	private readonly trailLength = 30
	private readonly speedFactor = 0.002
	private heatmapSourceAdded = false
	private lastFrameTime = 0
	private readonly frameInterval = 50 // ~20fps

	constructor(map: any) {
		this.map = map

		// Clean up any orphaned canvases from HMR
		const container = map.getCanvas().parentElement
		container
			?.querySelectorAll("[data-wind-layer]")
			.forEach((el: Element) => el.remove())

		this.canvas = document.createElement("canvas")
		this.canvas.dataset.windLayer = "particles"
		this.canvas.style.cssText =
			"position:absolute;top:0;left:0;pointer-events:none;width:100%;height:100%;"
		this.ctx = this.canvas.getContext("2d")!
		container?.append(this.canvas)

		this.resize()
		map.on("resize", () => this.resize())
		// Clear particle trails on map interaction — they're in screen-space
		map.on("move", () => {
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
			// Reset all trails so they rebuild from current screen positions
			for (const p of this.particles) {
				p.trail = []
			}
		})
	}

	private resize() {
		// Use CSS pixel dimensions — map.project()/unproject() return CSS pixels
		const el = this.map.getCanvas()
		this.canvas.width = el.clientWidth
		this.canvas.height = el.clientHeight
	}

	async setData(data: FieldData) {
		const wd = data as WindFieldData
		this.windData = wd

		const img = new Image()
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve()
			img.onerror = reject
			img.src = wd.image
		})

		const c = document.createElement("canvas")
		c.width = wd.width
		c.height = wd.height
		const cx = c.getContext("2d")!
		cx.drawImage(img, 0, 0)
		this.windImage = cx.getImageData(0, 0, wd.width, wd.height)

		this.particles = []
		for (let i = 0; i < this.targetParticleCount(); i++) {
			this.particles.push(this.randomParticle())
		}

		// Build heatmap as MapLibre layer (renders between terrain and labels)
		// Must wait for style to be fully loaded before adding sources/layers
		if (this.map.isStyleLoaded()) {
			this.buildHeatmap()
		} else {
			this.map.once("style.load", () => this.buildHeatmap())
		}
		this.map.on("moveend", () => this.updateHeatmap())
		this.map.on("zoomend", () => this.updateHeatmap())
	}

	/** Render heatmap to offscreen canvas, add as MapLibre image source between terrain and labels */
	private buildHeatmap() {
		if (!this.windData || !this.windImage) {
			return
		}

		const dataUrl = this.renderHeatmapImage()
		const [west, south, east, north] = this.windData.bbox
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
			if (this.map.getLayer("wind-heatmap")) {
				this.map.removeLayer("wind-heatmap")
			}
			if (this.map.getSource("wind-heatmap")) {
				this.map.removeSource("wind-heatmap")
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

		this.map.addSource("wind-heatmap", {
			coordinates: coords,
			type: "image",
			url: dataUrl,
		})

		this.map.addLayer(
			{
				id: "wind-heatmap",
				paint: { "raster-fade-duration": 0, "raster-opacity": 0.5 },
				source: "wind-heatmap",
				type: "raster",
			},
			insertBefore
		)

		this.heatmapSourceAdded = true
	}

	private updateHeatmap() {
		if (!this.heatmapSourceAdded || !this.windData || !this.windImage) {
			return
		}
		const source = this.map.getSource("wind-heatmap") as any
		if (!source) {
			return
		}

		const dataUrl = this.renderHeatmapImage()
		const [west, south, east, north] = this.windData.bbox
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

	/** Render wind speed grid to an offscreen canvas, return data URL */
	private renderHeatmapImage(): string {
		const wd = this.windData!
		const wi = this.windImage!
		const { bbox, width, height, uMin, uMax, vMin, vMax } = wd
		const [west, south, east, north] = bbox

		// Render at wind grid resolution for max detail
		const gridW = width
		const gridH = height
		const offscreen = document.createElement("canvas")
		offscreen.width = gridW
		offscreen.height = gridH
		const octx = offscreen.getContext("2d")!
		const imgData = octx.createImageData(gridW, gridH)
		const { data } = imgData

		for (let gy = 0; gy < gridH; gy++) {
			for (let gx = 0; gx < gridW; gx++) {
				const i = (gy * gridW + gx) * 4
				const wi_i = (gy * width + gx) * 4
				const u = uMin + (wi.data[wi_i] / 255) * (uMax - uMin)
				const v = vMin + (wi.data[wi_i + 1] / 255) * (vMax - vMin)
				const speed = Math.sqrt(u * u + v * v)

				const t = Math.min(speed / 30, 1) * (SPEED_COLORS.length - 1)
				const ci = Math.floor(t)
				const f = t - ci
				const a = SPEED_COLORS[Math.min(ci, SPEED_COLORS.length - 1)]
				const b = SPEED_COLORS[Math.min(ci + 1, SPEED_COLORS.length - 1)]

				data[i] = Math.round(a[0] + (b[0] - a[0]) * f)
				data[i + 1] = Math.round(a[1] + (b[1] - a[1]) * f)
				data[i + 2] = Math.round(a[2] + (b[2] - a[2]) * f)
				data[i + 3] = 255
			}
		}

		octx.putImageData(imgData, 0, 0)
		return offscreen.toDataURL()
	}

	/** Scale particle count — fewer when zoomed in since they're packed into smaller area */
	private targetParticleCount(): number {
		const zoom = this.map.getZoom()
		const scale = 2 ** (this.baseZoom - zoom)
		return Math.max(
			200,
			Math.round(this.baseParticleCount * Math.min(1, scale))
		)
	}

	private randomParticle(): Particle {
		if (!this.windData) {
			return { age: 0, lat: -28, lng: 134, maxAge: 60, trail: [] }
		}
		const [bboxW, bboxS, bboxE, bboxN] = this.windData.bbox

		// Spawn within visible viewport, clamped to wind data bbox
		const bounds = this.map.getBounds()
		const west = Math.max(bounds.getWest(), bboxW)
		const east = Math.min(bounds.getEast(), bboxE)
		const south = Math.max(bounds.getSouth(), bboxS)
		const north = Math.min(bounds.getNorth(), bboxN)

		return {
			age: Math.floor(Math.random() * 60),
			lat: south + Math.random() * (north - south),
			lng: west + Math.random() * (east - west),
			maxAge: 40 + Math.floor(Math.random() * 40),
			trail: [],
		}
	}

	private getWind(lng: number, lat: number): [number, number] | null {
		if (!this.windData || !this.windImage) {
			return null
		}
		const { bbox, width, height, uMin, uMax, vMin, vMax } = this.windData
		const [west, south, east, north] = bbox

		if (lng < west || lng > east || lat < south || lat > north) {
			return null
		}

		const gx = ((lng - west) / (east - west)) * (width - 1)
		const gy = ((north - lat) / (north - south)) * (height - 1)

		const x0 = Math.floor(gx)
		const y0 = Math.floor(gy)
		const x1 = Math.min(x0 + 1, width - 1)
		const y1 = Math.min(y0 + 1, height - 1)
		const fx = gx - x0
		const fy = gy - y0

		const pix = (x: number, y: number): [number, number] => {
			const i = (y * width + x) * 4
			return [
				uMin + (this.windImage!.data[i] / 255) * (uMax - uMin),
				vMin + (this.windImage!.data[i + 1] / 255) * (vMax - vMin),
			]
		}

		const [u00, v00] = pix(x0, y0)
		const [u10, v10] = pix(x1, y0)
		const [u01, v01] = pix(x0, y1)
		const [u11, v11] = pix(x1, y1)

		return [
			u00 * (1 - fx) * (1 - fy) +
				u10 * fx * (1 - fy) +
				u01 * (1 - fx) * fy +
				u11 * fx * fy,
			v00 * (1 - fx) * (1 - fy) +
				v10 * fx * (1 - fy) +
				v01 * (1 - fx) * fy +
				v11 * fx * fy,
		]
	}

	private frame = () => {
		if (!this.windData || !this.windImage) {
			this.animId = requestAnimationFrame(this.frame)
			return
		}

		const now = performance.now()
		if (now - this.lastFrameTime < this.frameInterval) {
			this.animId = requestAnimationFrame(this.frame)
			return
		}
		this.lastFrameTime = now

		const { ctx } = this
		const w = this.canvas.width
		const h = this.canvas.height
		const { bbox } = this.windData

		// Adjust particle count for current zoom
		const target = this.targetParticleCount()
		while (this.particles.length > target) {
			this.particles.pop()
		}
		while (this.particles.length < target) {
			this.particles.push(this.randomParticle())
		}

		// Clear entire canvas each frame — we redraw all trails
		ctx.clearRect(0, 0, w, h)

		for (const p of this.particles) {
			const wind = this.getWind(p.lng, p.lat)

			if (!wind || p.age >= p.maxAge) {
				Object.assign(p, this.randomParticle())
				continue
			}

			const [u, v] = wind
			const speed = Math.sqrt(u * u + v * v)

			// Move in geographic space — scale down at higher zoom so particles don't fly
			const zoom = this.map.getZoom()
			const zoomScale = this.speedFactor * 2 ** (4.5 - zoom)
			const distortion = Math.cos((p.lat * Math.PI) / 180)
			p.lng += (u * zoomScale) / Math.max(distortion, 0.1)
			p.lat += v * zoomScale
			p.age++

			// Project to screen and add to trail
			const screen = this.map.project([p.lng, p.lat])
			p.trail.push({ speed, x: screen.x, y: screen.y })

			// Trim trail
			if (p.trail.length > this.trailLength) {
				p.trail.shift()
			}

			// Reset if out of bbox
			if (
				p.lng < bbox[0] ||
				p.lng > bbox[2] ||
				p.lat < bbox[1] ||
				p.lat > bbox[3]
			) {
				Object.assign(p, this.randomParticle())
				continue
			}

			// Draw trail as gradient line segments
			if (p.trail.length < 2) {
				continue
			}

			for (let i = 1; i < p.trail.length; i++) {
				const prev = p.trail[i - 1]
				const curr = p.trail[i]

				// Skip if off-screen
				if (
					curr.x < -50 ||
					curr.x > w + 50 ||
					curr.y < -50 ||
					curr.y > h + 50
				) {
					continue
				}

				// Opacity fades along trail (head=bright, tail=dim)
				const progress = i / p.trail.length
				const alpha = progress * 0.9

				ctx.beginPath()
				ctx.moveTo(prev.x, prev.y)
				ctx.lineTo(curr.x, curr.y)
				ctx.strokeStyle = "rgba(255,255,255,0.9)"
				ctx.globalAlpha = alpha
				ctx.lineWidth = 1 + progress * 1
				ctx.stroke()
			}
		}

		ctx.globalAlpha = 1
		this.animId = requestAnimationFrame(this.frame)
	}

	start() {
		if (this.animId) {
			return
		}
		this.animId = requestAnimationFrame(this.frame)
	}

	stop() {
		if (this.animId) {
			cancelAnimationFrame(this.animId)
			this.animId = null
		}
	}

	destroy() {
		this.stop()
		this.canvas.remove()
		if (this.heatmapSourceAdded) {
			try {
				this.map.removeLayer("wind-heatmap")
				this.map.removeSource("wind-heatmap")
			} catch {}
			this.heatmapSourceAdded = false
		}
	}
}
