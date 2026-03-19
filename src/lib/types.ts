export interface FacilityUnit {
	code: string
	capacity: number
	currentPower: number
	capacityFactor: number
	active: boolean
	lastSeen: string
}

export interface Facility {
	code: string
	name: string
	region: string
	lat: number
	lng: number
	units: FacilityUnit[]
	totalCapacity: number
	currentPower: number
	capacityFactor: number
	active: boolean
}

export interface FacilityData {
	facilities: Facility[]
	lastUpdated: string
	totalCapacity: number
	totalPower: number
	aggregateCapacityFactor: number
}

export interface WindFieldMeta {
	/** Vercel Blob URL to the wind PNG texture */
	url: string
	/** Grid width in pixels */
	width: number
	/** Grid height in pixels */
	height: number
	/** Min U wind component (m/s) */
	uMin: number
	/** Max U wind component (m/s) */
	uMax: number
	/** Min V wind component (m/s) */
	vMin: number
	/** Max V wind component (m/s) */
	vMax: number
	/** [west, south, east, north] in degrees */
	bbox: [number, number, number, number]
	/** GFS forecast timestamp */
	timestamp: string
	lastUpdated: string
}

export interface WindFieldData {
	image: string
	width: number
	height: number
	uMin: number
	uMax: number
	vMin: number
	vMax: number
	bbox: [number, number, number, number]
}

export interface SolarFieldData {
	image: string
	width: number
	height: number
	bbox: [number, number, number, number]
	timestamp: string
}

export type FieldData = WindFieldData | SolarFieldData

export interface FieldRenderer {
	setData(data: FieldData): Promise<void>
	start(): void
	stop(): void
	destroy(): void
}
