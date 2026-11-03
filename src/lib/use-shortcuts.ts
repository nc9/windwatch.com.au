import { useEffect } from "react"

import { RANGES } from "./url-state"

const STEP = 5 * 60_000
const HOUR = 3_600_000

interface Options {
	earliest: number
	latest: number
	rangeMs: number
	selectedTime: number | null
	onTimeChange: (ts: number | null) => void
	onRangeChange: (ms: number) => void
	helpOpen: boolean
	onHelpChange: (open: boolean) => void
}

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null
	if (!el) {return false}
	return (
		el.tagName === "INPUT" ||
		el.tagName === "TEXTAREA" ||
		el.tagName === "SELECT" ||
		el.isContentEditable
	)
}

/** Global keyboard shortcuts: time travel, range presets, live, help */
export function useShortcuts({
	earliest,
	latest,
	rangeMs,
	selectedTime,
	onTimeChange,
	onRangeChange,
	helpOpen,
	onHelpChange,
}: Options) {
	useEffect(() => {
		const move = (delta: number) => {
			const next = (selectedTime ?? latest) + delta
			if (delta > 0 && next >= latest) {
				onTimeChange(null)
			} else {
				onTimeChange(Math.max(earliest, next))
			}
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) {return}

			if (e.key === "?") {
				e.preventDefault()
				onHelpChange(!helpOpen)
				return
			}
			if (e.key === "Escape") {
				if (helpOpen) {onHelpChange(false)}
				return
			}
			// Modal open: leave the timeline alone
			if (helpOpen) {return}

			const range = RANGES[Number(e.key) - 1]
			if (range) {
				e.preventDefault()
				onRangeChange(range.ms)
				return
			}

			switch (e.key) {
				case "ArrowLeft": {
					e.preventDefault()
					move(e.shiftKey ? -HOUR : -STEP)
					break
				}
				case "ArrowRight": {
					e.preventDefault()
					move(e.shiftKey ? HOUR : STEP)
					break
				}
				case "Home": {
					e.preventDefault()
					onTimeChange(Math.max(earliest, latest - rangeMs))
					break
				}
				case "End":
				case "l":
				case "L": {
					e.preventDefault()
					onTimeChange(null)
					break
				}
			}
		}

		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [
		earliest,
		latest,
		rangeMs,
		selectedTime,
		onTimeChange,
		onRangeChange,
		helpOpen,
		onHelpChange,
	])
}
