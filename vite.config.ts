import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	define: {
		"import.meta.env.VITE_MODE": JSON.stringify(
			process.env.VITE_MODE ?? "wind"
		),
	},
	plugins: [react(), tailwindcss()],
})
