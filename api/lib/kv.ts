import { createClient } from "@vercel/kv"

/** Create a KV client that resolves env vars with or without prefix */
export function getKV() {
	const url =
		process.env.KV_REST_API_URL || process.env.kv_KV_REST_API_URL || ""
	const token =
		process.env.KV_REST_API_TOKEN || process.env.kv_KV_REST_API_TOKEN || ""
	if (!url || !token) {
		throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN")
	}
	return createClient({ url, token })
}
