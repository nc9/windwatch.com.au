/** Pure sun position math — no dependencies */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

function dayOfYear(date: Date): number {
	const start = Date.UTC(date.getUTCFullYear(), 0, 0)
	return (date.getTime() - start) / 86_400_000
}

export function solarDeclination(date: Date): number {
	return -23.44 * DEG * Math.cos(((2 * Math.PI) / 365) * (dayOfYear(date) + 10))
}

export function sunElevation(lat: number, lng: number, date: Date): number {
	const dec = solarDeclination(date)
	const latRad = lat * DEG
	const hours =
		date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
	const hourAngle = ((hours - 12) * 15 + lng) * DEG
	const sinEl =
		Math.sin(latRad) * Math.sin(dec) +
		Math.cos(latRad) * Math.cos(dec) * Math.cos(hourAngle)
	return Math.asin(Math.max(-1, Math.min(1, sinEl))) * RAD
}

export function sunTimes(
	lat: number,
	lng: number,
	date: Date
): { sunrise: Date; sunset: Date } {
	const dec = solarDeclination(date)
	const latRad = lat * DEG
	const cosH = Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(dec)))
	const H = Math.acos(cosH) * RAD // half-day in degrees
	const noonUTC = 12 - lng / 15 // solar noon in UTC hours
	const sunriseUTC = noonUTC - H / 15
	const sunsetUTC = noonUTC + H / 15

	const d = new Date(date)
	d.setUTCHours(0, 0, 0, 0)
	const base = d.getTime()

	return {
		sunrise: new Date(base + sunriseUTC * 3_600_000),
		sunset: new Date(base + sunsetUTC * 3_600_000),
	}
}

export function sunProgress(lat: number, lng: number, date: Date): number {
	const { sunrise, sunset } = sunTimes(lat, lng, date)
	const t = date.getTime()
	if (t <= sunrise.getTime()) {return 0}
	if (t >= sunset.getTime()) {return 1}
	return (t - sunrise.getTime()) / (sunset.getTime() - sunrise.getTime())
}
