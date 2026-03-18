export type WindUnit = {
	code: string
	capacity: number
	currentPower: number
	capacityFactor: number
	active: boolean
	lastSeen: string
}

export type WindFacility = {
	code: string
	name: string
	region: string
	lat: number
	lng: number
	units: WindUnit[]
	totalCapacity: number
	currentPower: number
	capacityFactor: number
	active: boolean
}

export type WindFacilityData = {
	facilities: WindFacility[]
	lastUpdated: string
	totalCapacity: number
	totalPower: number
	aggregateCapacityFactor: number
}

export type WindFieldMeta = {
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
