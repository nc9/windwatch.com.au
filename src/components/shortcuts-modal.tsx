import { useEffect, useRef } from "react"

interface Props {
	open: boolean
	onClose: () => void
}

const SHORTCUTS: { keys: string[]; action: string }[] = [
	{ action: "Step back 5 minutes", keys: ["←"] },
	{ action: "Step forward 5 minutes", keys: ["→"] },
	{ action: "Step 1 hour", keys: ["Shift", "←", "→"] },
	{ action: "Jump to start of range", keys: ["Home"] },
	{ action: "Back to live", keys: ["L", "End"] },
	{ action: "Range 6h, 24h, 3d, 7d", keys: ["1", "2", "3", "4"] },
	{ action: "Show or hide shortcuts", keys: ["?"] },
	{ action: "Close", keys: ["Esc"] },
]

export function ShortcutsModal({ open, onClose }: Props) {
	const closeRef = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		if (open) {closeRef.current?.focus()}
	}, [open])

	if (!open) {return null}

	return (
		<div
			className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 px-4"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Keyboard shortcuts"
				className="w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-neutral-100">
						Keyboard shortcuts
					</h2>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded px-1.5 text-neutral-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-neutral-400"
					>
						✕
					</button>
				</div>
				<dl className="space-y-2.5 text-sm">
					{SHORTCUTS.map((s) => (
						<div
							key={s.action}
							className="flex items-center justify-between gap-4"
						>
							<dt className="text-neutral-300">{s.action}</dt>
							<dd className="flex shrink-0 gap-1">
								{s.keys.map((k) => (
									<kbd
										key={k}
										className="min-w-6 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center font-mono text-xs text-neutral-200"
									>
										{k}
									</kbd>
								))}
							</dd>
						</div>
					))}
				</dl>
				<p className="mt-4 text-xs text-neutral-500">
					The URL updates as you move through time, so you can share a snapshot.
				</p>
			</div>
		</div>
	)
}
