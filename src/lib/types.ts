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
	dataFirstSeen?: string | null
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

/** Compact facility snapshot for KV time series */
export interface FacilitySnapshot {
	ts: number
	/** Total power MW */
	t: number
	/** Aggregate capacity factor % */
	acf: number
	/** Facility code → [currentPower, capacityFactor] */
	f: Record<string, [number, number]>
}

/** Static facility metadata (stored once in KV) */
export interface FacilityMeta {
	facilities: {
		code: string
		name: string
		lat: number
		lng: number
		network: string
		region: string
		totalCapacity: number
		units: Array<{ code: string; capacity: number }>
	}[]
}

/** Timeline index from /api/history/index */
export interface TimelineIndex {
	earliest: number | null
	latest: number | null
	count: number
}

/** Response from /api/history/snapshots */
export interface SnapshotResponse {
	snapshots: FacilitySnapshot[]
	meta: FacilityMeta | null
}
