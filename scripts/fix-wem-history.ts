/**
 * Repair WEM values in the KV facility time series.
 *
 * The cron queried WEM power with an AEST (+10) window, which returns no data
 * for WA, so every stored snapshot has WEM facilities at 0. This patches ONLY
 * the WEM entries (and the totals) in place, keeping NEM values as written.
 *
 * Dry run by default:
 *   bun --env-file=.env.local run scripts/fix-wem-history.ts
 * Apply (backs up the raw members first):
 *   APPLY=1 BACKUP_PATH=/path/backup.json bun --env-file=.env.local run scripts/fix-wem-history.ts
 */

import { writeFileSync } from "node:fs"

import { createClient } from "@vercel/kv"
import { OpenElectricityClient } from "openelectricity"

const fueltech = process.env.FUELTECH || "wind"
const APPLY = process.env.APPLY === "1"
const FIVE_MIN_MS = 300_000
const WEM_OFFSET_MS = 8 * 3_600_000
const MAX_STALE_MS = 15 * 60_000
const BATCH = 50

type Snapshot = {
	acf: number
	f: Record<string, [number, number]>
	t: number
	ts: number
}

async function main() {
	const kvUrl = process.env.KV_REST_API_URL
	const kvToken = process.env.KV_REST_API_TOKEN
	if (!kvUrl || !kvToken) throw new Error("KV_REST_API_URL/TOKEN required")

	// Raw strings so ZREM matches the stored member byte for byte
	const kv = createClient({
		automaticDeserialization: false,
		token: kvToken,
		url: kvUrl,
	})
	const key = `ts:${fueltech}:facilities`

	const metaRaw = await kv.get<string>(`meta:${fueltech}:facilities`)
	const meta = typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw
	const facs: any[] = meta.facilities
	const wem = facs.filter((f) => f.network === "WEM")
	const totalCapacity = facs.reduce((s, f) => s + f.totalCapacity, 0)
	const unitToFac = new Map<string, string>()
	for (const f of wem) for (const u of f.units) unitToFac.set(u.code, f.code)
	console.log(`${wem.length} WEM facilities, ${unitToFac.size} units`)

	// 1. Existing members, raw
	const flat = (await kv.zrange(key, 0, -1, { withScores: true })) as (
		| string
		| number
	)[]
	const members: { raw: string; score: number }[] = []
	for (let i = 0; i < flat.length; i += 2) {
		members.push({ raw: String(flat[i]), score: Number(flat[i + 1]) })
	}
	console.log(`${members.length} snapshots in KV (${key})`)
	if (members.length === 0) return

	// 2. WEM power per unit, 5 min, back to the oldest snapshot
	const oldest = members[0].score
	const client = new OpenElectricityClient()
	const start = new Date(oldest - 3_600_000)
	const naive = new Date(start.getTime() + WEM_OFFSET_MS)
		.toISOString()
		.slice(0, 19)
	const power = new Map<string, Map<number, number>>() // unit -> ms -> MW
	const codes = wem.map((f) => f.code)
	for (let i = 0; i < codes.length; i += 20) {
		const { datatable } = await client.getFacilityData(
			"WEM",
			codes.slice(i, i + 20),
			["power"],
			{ dateStart: naive, interval: "5m" },
		)
		for (const row of datatable?.getRows() ?? []) {
			const p = row.power as number
			if (typeof p !== "number" || Number.isNaN(p) || p < 0) continue
			const ms = (row.interval as Date).getTime()
			const u = row.unit_code as string
			if (!power.has(u)) power.set(u, new Map())
			power.get(u)!.set(ms, p)
		}
	}
	console.log(`WEM power for ${power.size} units fetched from ${naive} (AWST)`)

	// Latest reading at or before ts, no staler than MAX_STALE_MS
	const at = (unit: string, ts: number): number | null => {
		const m = power.get(unit)
		if (!m) return null
		const base = Math.floor(ts / FIVE_MIN_MS) * FIVE_MIN_MS
		for (let d = 0; d <= MAX_STALE_MS; d += FIVE_MIN_MS) {
			const v = m.get(base - d)
			if (v != null) return v
		}
		return null
	}

	// 3. Patch
	const patched: { old: string; next: string; score: number }[] = []
	let skippedNoData = 0
	let wemBefore = 0
	let wemAfter = 0
	for (const { raw, score } of members) {
		const snap = JSON.parse(raw) as Snapshot
		let changed = false
		for (const f of wem) {
			let sum = 0
			let have = false
			for (const u of f.units) {
				const v = at(u.code, snap.ts)
				if (v != null) {
					sum += v
					have = true
				}
			}
			if (!have) continue
			const next: [number, number] = [
				Math.round(sum * 100) / 100,
				f.totalCapacity > 0
					? Number(((sum / f.totalCapacity) * 100).toFixed(1))
					: 0,
			]
			wemBefore += snap.f[f.code]?.[0] ?? 0
			wemAfter += next[0]
			if (snap.f[f.code]?.[0] !== next[0]) changed = true
			snap.f[f.code] = next
		}
		if (!changed) {
			skippedNoData++
			continue
		}
		snap.t =
			Math.round(Object.values(snap.f).reduce((s, v) => s + v[0], 0) * 100) /
			100
		snap.acf =
			totalCapacity > 0 ? Number(((snap.t / totalCapacity) * 100).toFixed(1)) : 0
		patched.push({ next: JSON.stringify(snap), old: raw, score })
	}

	console.log(
		`\n${patched.length} snapshots to patch, ${skippedNoData} unchanged (no WEM data / already correct)`,
	)
	console.log(
		`avg WEM MW per patched snapshot: before ${(wemBefore / Math.max(1, patched.length)).toFixed(1)} -> after ${(wemAfter / Math.max(1, patched.length)).toFixed(1)}`,
	)
	console.log(
		`range: ${new Date(members[0].score).toISOString()} -> ${new Date(members.at(-1)!.score).toISOString()}`,
	)

	if (!APPLY) {
		console.log("\nDRY RUN: nothing written. Set APPLY=1 to write.")
		return
	}

	// 4. Backup then swap members at the same score
	const backup = process.env.BACKUP_PATH
	if (!backup) throw new Error("BACKUP_PATH required with APPLY=1")
	writeFileSync(backup, JSON.stringify(members))
	console.log(`\nBackup of ${members.length} members -> ${backup}`)

	for (let i = 0; i < patched.length; i += BATCH) {
		const tx = kv.multi()
		for (const p of patched.slice(i, i + BATCH)) {
			tx.zrem(key, p.old)
			tx.zadd(key, { member: p.next, score: p.score })
		}
		await tx.exec()
		process.stdout.write(
			`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(patched.length / BATCH)}\n`,
		)
	}

	const after = await kv.zcard(key)
	console.log(`\nDone. KV count before ${members.length}, after ${after}`)
	if (after !== members.length) {
		console.error("COUNT MISMATCH: restore from backup")
		process.exitCode = 1
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
