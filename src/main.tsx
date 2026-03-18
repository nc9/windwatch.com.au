import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"

import { App } from "./app"

import "./styles.css"

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchInterval: 5 * 60 * 1000, // 5 minutes
			staleTime: 4 * 60 * 1000,
			retry: 2,
		},
	},
})

createRoot(document.querySelector("#root")!).render(
	<QueryClientProvider client={queryClient}>
		<App />
	</QueryClientProvider>
)
