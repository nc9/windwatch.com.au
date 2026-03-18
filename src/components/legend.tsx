export function Legend() {
	return (
		<div className="pointer-events-auto absolute bottom-8 left-4 z-10 grid grid-cols-[auto_9rem_auto] items-center gap-x-1.5 gap-y-1 rounded-lg border border-neutral-800 bg-neutral-950/90 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
			<div className="col-span-3 text-neutral-400">Capacity Factor</div>
			<span className="text-right text-neutral-500">Off</span>
			<div
				className="h-2.5 rounded-sm"
				style={{
					background:
						"linear-gradient(to right, #ffffff 0%, #d4ff70 15%, #4ade80 35%, #16a34a 60%, #15803d 100%)",
				}}
			/>
			<span className="text-neutral-500">40%+</span>
			<div className="col-span-3 mt-1 text-neutral-400">Wind Speed</div>
			<span className="text-right text-neutral-500">0</span>
			<div
				className="h-2.5 rounded-sm"
				style={{
					background:
						"linear-gradient(to right, rgb(60,20,120) 0%, rgb(60,70,200) 10%, rgb(100,160,255) 25%, rgb(60,210,230) 35%, rgb(80,230,120) 50%, rgb(240,240,50) 65%, rgb(255,180,40) 75%, rgb(255,90,50) 88%, rgb(255,60,180) 100%)",
				}}
			/>
			<span className="text-neutral-500">30 m/s</span>
		</div>
	)
}
