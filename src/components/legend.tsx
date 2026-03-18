export function Legend() {
	return (
		<div className="pointer-events-auto absolute bottom-8 left-4 z-10 rounded-lg border border-neutral-800 bg-neutral-950/90 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
			<div className="mb-1.5 text-neutral-400">Capacity Factor</div>
			<div className="flex items-center gap-1.5">
				<span className="text-neutral-500">Off</span>
				<div
					className="h-2.5 w-36 rounded-sm"
					style={{
						background:
							"linear-gradient(to right, #ef4444 0%, #ffffff 8%, #d4ff70 15%, #4ade80 30%, #16a34a 50%, #15803d 100%)",
					}}
				/>
				<span className="text-neutral-500">40%+</span>
			</div>
		</div>
	)
}
