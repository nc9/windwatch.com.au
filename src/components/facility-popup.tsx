import { formatMW, formatPercent, regionName } from "../lib/format"
import { capacityFactorColor } from "../lib/colors"

/**
 * Returns HTML string for a MapLibre popup (not a React component —
 * MapLibre popups use innerHTML).
 */
export function FacilityPopup(props: Record<string, unknown>): string {
	const name = props.name as string
	const code = props.code as string
	const region = props.region as string
	const totalCapacity = props.totalCapacity as number
	const currentPower = props.currentPower as number
	const capacityFactor = props.capacityFactor as number
	const active = props.active as boolean
	const unitCount = props.unitCount as number

	const cfColor = capacityFactorColor(capacityFactor)
	const cfWidth = Math.max(2, Math.min(100, capacityFactor))

	return `
		<div style="font-family: system-ui, sans-serif; color: #e5e5e5; font-size: 13px;">
			<div style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">
				<a href="https://explore.openelectricity.org.au/facility/${code}" target="_blank" rel="noopener"
					style="color: #60a5fa; text-decoration: none;">${name}</a>
			</div>
			<div style="color: #a3a3a3; margin-bottom: 8px;">
				${regionName(region)} · ${unitCount} unit${unitCount !== 1 ? "s" : ""}
			</div>
			<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
				<span>Generation</span>
				<span style="font-weight: 600;">${active ? formatMW(currentPower) : "Offline"}</span>
			</div>
			<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
				<span>Capacity</span>
				<span>${formatMW(totalCapacity)}</span>
			</div>
			<div style="margin-top: 6px;">
				<div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
					<span>Capacity Factor</span>
					<span style="font-weight: 600;">${formatPercent(capacityFactor)}</span>
				</div>
				<div style="background: #262626; border-radius: 4px; height: 6px; overflow: hidden;">
					<div style="background: ${cfColor}; width: ${cfWidth}%; height: 100%; border-radius: 4px;"></div>
				</div>
			</div>
		</div>
	`
}
