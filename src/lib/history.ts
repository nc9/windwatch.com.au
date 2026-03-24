import type {
	FacilityData,
	FacilityMeta,
	FacilitySnapshot,
	FieldData,
	SnapshotResponse,
} from "./types"

/** Fetch the full history file (meta + all snapshots) */
export async function fetchHistory(url: string): Promise<SnapshotResponse> {
	const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })
	if (!r.ok) return { meta: null, snapshots: [] }
	return r.json()
}

/** Find the snapshot closest to a given timestamp */
export function findClosestSnapshot(
	snapshots: FacilitySnapshot[],
	ts: number,
): FacilitySnapshot | null {
	if (snapshots.length === 0) return null

	// Binary search for closest
	let lo = 0
	let hi = snapshots.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (snapshots[mid].ts < ts) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}

	// Check neighbors for closest
	const candidates = [lo - 1, lo].filter(
		(i) => i >= 0 && i < snapshots.length,
	)
	let best = candidates[0]
	for (const i of candidates) {
		if (
			Math.abs(snapshots[i].ts - ts) < Math.abs(snapshots[best].ts - ts)
		) {
			best = i
		}
	}
	return snapshots[best]
}

/** Merge static metadata + compact snapshot into full FacilityData */
export function mergeSnapshot(
	meta: FacilityMeta,
	snap: FacilitySnapshot,
): FacilityData {
	const facilities = meta.facilities.map((m) => {
		const [power, cf] = snap.f[m.code] ?? [0, 0]
		return {
			active: power > 0,
			capacityFactor: cf,
			code: m.code,
			currentPower: power,
			lat: m.lat,
			lng: m.lng,
			name: m.name,
			region: m.region,
			totalCapacity: m.totalCapacity,
			units: m.units.map((u) => ({
				active: power > 0,
				capacity: u.capacity,
				capacityFactor: 0,
				code: u.code,
				currentPower: 0,
				lastSeen: "",
			})),
		}
	})

	const totalCapacity = meta.facilities.reduce(
		(s, f) => s + f.totalCapacity,
		0,
	)

	return {
		aggregateCapacityFactor: snap.acf,
		facilities,
		lastUpdated: new Date(snap.ts).toISOString(),
		totalCapacity,
		totalPower: snap.t,
	}
}
