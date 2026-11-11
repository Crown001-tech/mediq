import { CaseSLAInfo } from '../types'

export function computeCaseSLA(urgency: string, createdAt: string, status: string): CaseSLAInfo {
  let targetHours = 24
  if (urgency === 'needs_live_call') targetHours = 2
  else if (urgency === 'somewhat_urgent') targetHours = 6

  const targetMs = targetHours * 60 * 60 * 1000
  const elapsedMs = Date.now() - new Date(createdAt).getTime()
  const remainingMs = targetMs - elapsedMs

  const isResponded = status === 'responded' || status === 'closed' || status === 'resolved'
  const isBreached = !isResponded && remainingMs <= 0
  const isWarning = !isResponded && !isBreached && elapsedMs >= targetMs * 0.75

  let timeRemainingStr = ''
  let overdueStr = ''

  if (remainingMs > 0) {
    const mins = Math.floor(remainingMs / 60000)
    if (mins < 60) {
      timeRemainingStr = `${mins}m left`
    } else {
      const hrs = Math.floor(mins / 60)
      const remMins = mins % 60
      timeRemainingStr = remMins > 0 ? `${hrs}h ${remMins}m left` : `${hrs}h left`
    }
  } else {
    const overdueMins = Math.floor(Math.abs(remainingMs) / 60000)
    if (overdueMins < 60) {
      overdueStr = `${overdueMins}m overdue`
    } else {
      const overdueHrs = Math.floor(overdueMins / 60)
      overdueStr = `${overdueHrs}h overdue`
    }
  }

  return {
    targetHours,
    slaLabel: `${targetHours}h SLA`,
    elapsedMs,
    remainingMs,
    isWarning,
    isBreached,
    timeRemainingStr,
    overdueStr,
  }
}
