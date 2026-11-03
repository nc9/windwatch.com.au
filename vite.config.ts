import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	define: {
		"import.meta.env.VITE_MODE": JSON.stringify(
			process.env.VITE_MODE ?? "wind"
		),
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: (id) =>
					id.includes("node_modules/maplibre-gl") ? "maplibre" : undefined,
			},
		},
	},
	plugins: [react(), tailwindcss()],
	// Vite doesn't serve the Vercel functions, so time-travel field history
	// (/api/history/field) would 404 in dev and silently show the live wind
	server: {
		proxy: {
			"/api": {
				changeOrigin: true,
				target: process.env.VITE_API_PROXY ?? "https://windwatch.com.au",
			},
		},
	},
})
