/**
 * Windy.com-style wind particle animation.
 * Particles flow along wind paths with speed-based coloring and smooth trails.
 */

export type WindData = {
	image: string
	width: number
	height: number
	uMin: number
	uMax: number
	vMin: number
	vMax: number
	bbox: [number, number, number, number] // [west, south, east, north]
}

type Particle = {
	lng: number
	lat: number
	age: number
	maxAge: number
	trail: Array<{ x: number; y: number; speed: number }>
}

// Wind speed → color (blue=calm, cyan, green, yellow, orange, red=strong)
const SPEED_COLORS = [
	[30, 60, 120],    // 0 m/s — dark blue
	[50, 120, 180],   // 3 m/s — blue
	[80, 180, 200],   // 6 m/s — cyan
	[100, 200, 150],  // 9 m/s — teal
	[160, 220, 100],  // 12 m/s — yellow-green
	[220, 200, 60],   // 15 m/s — yellow
	[240, 150, 40],   // 18 m/s — orange
	[240, 80, 30],    // 21 m/s — red-orange
	[220, 40, 40],    // 24+ m/s — red
]

function speedColor(speed: number): string {
	const t = Math.min(speed / 25, 1) * (SPEED_COLORS.length - 1)
	const i = Math.floor(t)
	const f = t - i
	const a = SPEED_COLORS[Math.min(i, SPEED_COLORS.length - 1)]
	const b = SPEED_COLORS[Math.min(i + 1, SPEED_COLORS.length - 1)]
	const r = Math.round(a[0] + (b[0] - a[0]) * f)
	const g = Math.round(a[1] + (b[1] - a[1]) * f)
	const bl = Math.round(a[2] + (b[2] - a[2]) * f)
	return `rgb(${r},${g},${bl})`
}

export class WindParticleRenderer {
	private canvas: HTMLCanvasElement
	private ctx: CanvasRenderingContext2D
	private map: any
	private windData: WindData | null = null
	private windImage: ImageData | null = null
	private particles: Particle[] = []
	private animId: number | null = null
	private readonly particleCount = 4000
	private readonly trailLength = 30
	private readonly speedFactor = 0.002
	private heatmapCanvas: HTMLCanvasElement | null = null
	private lastFrameTime = 0
	private readonly frameInterval = 50 // ~20fps

	constructor(map: any) {
		this.map = map

		this.canvas = document.createElement("canvas")
		this.canvas.style.cssText =
			"position:absolute;top:0;left:0;pointer-events:none;width:100%;height:100%;"
		this.ctx = this.canvas.getContext("2d")!

		const mapCanvas = map.getCanvas()
		mapCanvas.parentElement?.appendChild(this.canvas)

		this.resize()
		map.on("resize", () => this.resize())
	}

	private resize() {
		const { width, height } = this.map.getCanvas()
		this.canvas.width = width
		this.canvas.height = height
	}

	async setWindData(data: WindData) {
		this.windData = data

		const img = new Image()
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve()
			img.onerror = reject
			img.src = data.image
		})

		const c = document.createElement("canvas")
		c.width = data.width
		c.height = data.height
		const cx = c.getContext("2d")!
		cx.drawImage(img, 0, 0)
		this.windImage = cx.getImageData(0, 0, data.width, data.height)

		this.particles = []
		for (let i = 0; i < this.particleCount; i++) {
			this.particles.push(this.randomParticle())
		}

		// Build heatmap
		this.buildHeatmap()
		this.map.on("move", () => this.drawHeatmap())
		this.map.on("zoom", () => this.drawHeatmap())
	}

	/** Pre-render a wind speed heatmap canvas from the grid data */
	private buildHeatmap() {
		if (!this.windData || !this.windImage) return

		// Create a separate canvas for the heatmap, inserted BEFORE the particle canvas
		if (!this.heatmapCanvas) {
			this.heatmapCanvas = document.createElement("canvas")
			this.heatmapCanvas.style.cssText =
				"position:absolute;top:0;left:0;pointer-events:none;width:100%;height:100%;"
			this.canvas.parentElement?.insertBefore(this.heatmapCanvas, this.canvas)
		}

		this.drawHeatmap()
	}

	private drawHeatmap() {
		if (!this.heatmapCanvas || !this.windData || !this.windImage) return

		const hc = this.heatmapCanvas
		const { width: cw, height: ch } = this.map.getCanvas()
		hc.width = cw
		hc.height = ch
		const hctx = hc.getContext("2d")!

		hctx.clearRect(0, 0, cw, ch)

		const { bbox, width, height, uMin, uMax, vMin, vMax } = this.windData
		const [west, south, east, north] = bbox

		// Sample wind speed at a coarser grid and draw colored rectangles
		const step = 8 // pixels between samples
		for (let sy = 0; sy < ch; sy += step) {
			for (let sx = 0; sx < cw; sx += step) {
				const lngLat = this.map.unproject([sx, sy])
				const lng = lngLat.lng
				const lat = lngLat.lat

				if (lng < west || lng > east || lat < south || lat > north) continue

				const wind = this.getWind(lng, lat)
				if (!wind) continue

				const speed = Math.sqrt(wind[0] * wind[0] + wind[1] * wind[1])
				const color = speedColor(speed)

				hctx.fillStyle = color
				hctx.globalAlpha = Math.min(0.25, speed / 40)
				hctx.fillRect(sx, sy, step, step)
			}
		}

		hctx.globalAlpha = 1
	}

	private randomParticle(): Particle {
		if (!this.windData) return { lng: 134, lat: -28, age: 0, maxAge: 60, trail: [] }
		const [west, south, east, north] = this.windData.bbox
		return {
			lng: west + Math.random() * (east - west),
			lat: south + Math.random() * (north - south),
			age: Math.floor(Math.random() * 60),
			maxAge: 40 + Math.floor(Math.random() * 40),
			trail: [],
		}
	}

	private getWind(lng: number, lat: number): [number, number] | null {
		if (!this.windData || !this.windImage) return null
		const { bbox, width, height, uMin, uMax, vMin, vMax } = this.windData
		const [west, south, east, north] = bbox

		if (lng < west || lng > east || lat < south || lat > north) return null

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
			u00 * (1 - fx) * (1 - fy) + u10 * fx * (1 - fy) + u01 * (1 - fx) * fy + u11 * fx * fy,
			v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy,
		]
	}

	private frame = (timestamp: number = 0) => {
		if (!this.windData || !this.windImage) {
			this.animId = requestAnimationFrame(this.frame)
			return
		}

		// Throttle frame rate
		if (timestamp - this.lastFrameTime < this.frameInterval) {
			this.animId = requestAnimationFrame(this.frame)
			return
		}
		this.lastFrameTime = timestamp

		const ctx = this.ctx
		const w = this.canvas.width
		const h = this.canvas.height
		const bbox = this.windData.bbox

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

			// Move in geographic space with latitude correction
			const distortion = Math.cos((p.lat * Math.PI) / 180)
			p.lng += (u * this.speedFactor) / Math.max(distortion, 0.1)
			p.lat += v * this.speedFactor
			p.age++

			// Project to screen and add to trail
			const screen = this.map.project([p.lng, p.lat])
			p.trail.push({ x: screen.x, y: screen.y, speed })

			// Trim trail
			if (p.trail.length > this.trailLength) {
				p.trail.shift()
			}

			// Reset if out of bbox
			if (p.lng < bbox[0] || p.lng > bbox[2] || p.lat < bbox[1] || p.lat > bbox[3]) {
				Object.assign(p, this.randomParticle())
				continue
			}

			// Draw trail as gradient line segments
			if (p.trail.length < 2) continue

			for (let i = 1; i < p.trail.length; i++) {
				const prev = p.trail[i - 1]
				const curr = p.trail[i]

				// Skip if off-screen
				if (
					curr.x < -50 || curr.x > w + 50 ||
					curr.y < -50 || curr.y > h + 50
				) continue

				// Opacity fades along trail (head=bright, tail=dim)
				const progress = i / p.trail.length
				const alpha = progress * progress * 0.5

				ctx.beginPath()
				ctx.moveTo(prev.x, prev.y)
				ctx.lineTo(curr.x, curr.y)
				ctx.strokeStyle = speedColor(curr.speed)
				ctx.globalAlpha = alpha
				ctx.lineWidth = 0.8 + progress * 0.8
				ctx.stroke()
			}
		}

		ctx.globalAlpha = 1
		this.animId = requestAnimationFrame(this.frame)
	}

	start() {
		if (this.animId) return
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
		this.heatmapCanvas?.remove()
	}
}
