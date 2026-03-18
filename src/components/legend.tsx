export function Legend() {
	return (
		<div className="pointer-events-auto absolute right-4 bottom-10 z-10 rounded-lg border border-neutral-800 bg-neutral-950/90 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
			<div className="mb-1 text-neutral-400">Capacity Factor</div>
			<div className="flex items-center gap-1">
				<span className="text-neutral-500">0%</span>
				<div
					className="h-2 w-32 rounded-sm"
					style={{
						background:
							"linear-gradient(to right, #dc2626, #ea580c, #eab308, #65a30d, #22c55e)",
					}}
				/>
				<span className="text-neutral-500">100%</span>
			</div>
		</div>
	)
}
