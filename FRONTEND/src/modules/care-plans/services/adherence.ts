import { SupabaseClient } from '@supabase/supabase-js'
import {
  MedicationDurationInfo,
  CheckInStatus,
  DayAdherenceSlot,
  MedicationAdherenceStat,
  CheckInComplianceResult,
} from '../types'

/**
 * Parse stipulated medication duration (e.g. "5 Days", "30 Days", "Ongoing / Chronic")
 * and determine if course is active or completed.
 */
export function parseMedicationDuration(instructions?: string | null, planCreatedAt?: string | null): MedicationDurationInfo {
  const defaultRes: MedicationDurationInfo = {
    durationText: 'Ongoing / Chronic',
    isCompleted: false,
    currentDay: 1,
    totalDays: null,
    progressText: 'Active Chronic Regimen',
  }

  if (!instructions) return defaultRes

  const match = instructions.match(/Duration:\s*([^•]+)/i)
  const rawDuration = match ? match[1].trim() : ''

  if (!rawDuration || rawDuration.toLowerCase().includes('ongoing') || rawDuration.toLowerCase().includes('chronic')) {
    return defaultRes
  }

  const daysMatch = rawDuration.match(/(\d+)\s*Days?/i)
  if (daysMatch) {
    const totalDays = parseInt(daysMatch[1], 10)
    const startDate = planCreatedAt ? new Date(planCreatedAt).getTime() : Date.now()
    const elapsedDays = Math.max(1, Math.ceil((Date.now() - startDate) / (24 * 60 * 60 * 1000)))
    const isCompleted = elapsedDays > totalDays

    return {
      durationText: `${totalDays} Days`,
      isCompleted,
      currentDay: Math.min(elapsedDays, totalDays),
      totalDays,
      progressText: isCompleted ? 'Course Completed' : `Day ${elapsedDays} of ${totalDays}`,
    }
  }

  return {
    durationText: rawDuration,
    isCompleted: false,
    currentDay: 1,
    totalDays: null,
    progressText: 'Active Regimen',
  }
}

/**
 * Parse recovery check-in cadence details (Daily, Every 3 Days, Weekly, Monthly)
 */
export function parseCadence(schedule?: string | null): { label: string; intervalMs: number } {
  const s = (schedule || '').toLowerCase()
  if (s.includes('3 days') || s.includes('3_days')) {
    return { label: 'Every 3 Days', intervalMs: 3 * 24 * 60 * 60 * 1000 }
  }
  if (s.includes('weekly')) {
    return { label: 'Weekly', intervalMs: 7 * 24 * 60 * 60 * 1000 }
  }
  if (s.includes('monthly')) {
    return { label: 'Monthly', intervalMs: 30 * 24 * 60 * 60 * 1000 }
  }
  return { label: 'Daily', intervalMs: 24 * 60 * 60 * 1000 }
}

/**
 * Primary Clinical Red Flag Evaluator:
 * Triggers when a patient fails to submit a scheduled check-in past their cadence + 24h grace window.
 */
export function evaluateCheckInStatus(
  schedule?: string | null,
  latestCheckInLoggedAt?: string | null,
  planCreatedAt?: string | null
): CheckInStatus {
  if (!schedule && !planCreatedAt) {
    return { isOverdue: false, daysOverdue: 0, cadenceLabel: 'None', lastReportStr: 'No active plan' }
  }

  const cadence = parseCadence(schedule)
  const now = Date.now()
  const referenceTime = latestCheckInLoggedAt
    ? new Date(latestCheckInLoggedAt).getTime()
    : new Date(planCreatedAt || now).getTime()

  const elapsedMs = now - referenceTime
  // 24 hour grace period before raising red flag
  const overdueMs = elapsedMs - (cadence.intervalMs + 24 * 60 * 60 * 1000)
  const isOverdue = overdueMs > 0
  const daysOverdue = Math.max(1, Math.ceil(overdueMs / (24 * 60 * 60 * 1000)))

  return {
    isOverdue,
    daysOverdue,
    cadenceLabel: cadence.label,
    lastReportStr: latestCheckInLoggedAt
      ? new Date(latestCheckInLoggedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Never (since enrollment)',
  }
}

/**
 * 2-Hour Auto-Miss Dose Reconciliation:
 * Marks scheduled dose windows older than 2 hours that have no patient log as Missed.
 * Does not throw disruptive errors or alarms.
 */
export async function autoReconcileMissedDoses(
  supabase: SupabaseClient,
  carePlanId: string,
  patientId: string,
  medications: Array<{ id: string; instructions?: string | null; schedule_times?: string | null }>,
  planCreatedAt?: string | null
): Promise<void> {
  if (!carePlanId || !patientId || medications.length === 0) return

  try {
    const planStartTime = planCreatedAt ? new Date(planCreatedAt).getTime() : Date.now()
    const now = Date.now()
    const twoHoursMs = 2 * 60 * 60 * 1000

    // Only inspect up to past 5 days to avoid excessive historical backfill
    const lookbackLimit = Math.max(planStartTime, now - 5 * 24 * 60 * 60 * 1000)

    // Fetch existing dose logs for this plan
    const { data: existingLogs } = await supabase
      .from('dose_logs')
      .select('id, logged_at, notes')
      .eq('care_plans_id', carePlanId)

    const loggedDates = new Set(
      (existingLogs || []).map((l) => {
        const d = new Date(l.logged_at)
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      })
    )

    // For each medication, check active duration and schedule
    for (const med of medications) {
      const durationInfo = parseMedicationDuration(med.instructions, planCreatedAt)
      if (durationInfo.isCompleted) continue // Don't reconcile for completed courses

      // Determine scheduled times of day
      const times: string[] = []
      if (med.schedule_times) {
        times.push(...med.schedule_times.split(',').map((t) => t.trim()))
      } else {
        // Fallback default: 09:00 morning dose
        times.push('09:00')
      }

      // Check each day in lookback window
      const oneDayMs = 24 * 60 * 60 * 1000
      for (let dayTimestamp = lookbackLimit; dayTimestamp <= now; dayTimestamp += oneDayMs) {
        const dayDate = new Date(dayTimestamp)
        const dateKey = `${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`

        // Parse scheduled time for this day
        for (const timeStr of times) {
          const [hours, minutes] = timeStr.split(':').map((n) => parseInt(n, 10))
          if (isNaN(hours)) continue

          const scheduledDateTime = new Date(dayDate)
          scheduledDateTime.setHours(hours, minutes || 0, 0, 0)
          const scheduledMs = scheduledDateTime.getTime()

          // Must be in the past + 2 hours grace period has expired
          if (now - scheduledMs > twoHoursMs && scheduledMs >= planStartTime) {
            // Check if already logged
            const alreadyLogged = (existingLogs || []).some((l) => {
              const logTime = new Date(l.logged_at).getTime()
              const isSameTimeWindow = Math.abs(logTime - scheduledMs) < 3 * 60 * 60 * 1000
              const isSameMed = l.notes?.includes(`[MedId:${med.id}]`) || false
              return isSameTimeWindow && isSameMed
            })

            if (!alreadyLogged) {
              // Silently insert auto-missed record
              await supabase.from('dose_logs').insert({
                care_plans_id: carePlanId,
                patient_id: patientId,
                taken: false,
                logged_at: scheduledDateTime.toISOString(),
                feeling_tag: 'Auto-Reconciled',
                notes: `System marked dose as missed (2-hour window elapsed). [MedId:${med.id}]`,
              })
            }
          }
        }
      }
    }
  } catch (err) {
    // Non-blocking background reconciliation
    console.warn('Auto-reconcile missed doses notice:', err)
  }
}

/**
 * Computes a 14-day longitudinal adherence activity strip.
 */
export function calculateLongitudinalAdherence(
  doseLogs: Array<{ logged_at: string; taken: boolean; feeling_tag?: string | null; notes?: string | null }>,
  planCreatedAt?: string | null
): DayAdherenceSlot[] {
  const days: DayAdherenceSlot[] = []
  const now = new Date()
  const planStartTime = planCreatedAt ? new Date(planCreatedAt).getTime() : 0

  for (let i = 13; i >= 0; i--) {
    const target = new Date()
    target.setDate(now.getDate() - i)
    target.setHours(0, 0, 0, 0)
    const endOfDay = new Date(target)
    endOfDay.setHours(23, 59, 59, 999)

    const dateStr = target.toISOString().split('T')[0]
    const isToday = i === 0

    const dayLabel = isToday
      ? 'Today'
      : target.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })

    // Filter logs for this calendar day
    const dayLogs = doseLogs.filter((l) => {
      const logTime = new Date(l.logged_at).getTime()
      return logTime >= target.getTime() && logTime <= endOfDay.getTime()
    })

    const takenCount = dayLogs.filter((l) => l.taken).length
    const missedCount = dayLogs.filter((l) => !l.taken).length
    const totalCount = takenCount + missedCount

    let status: 'full' | 'partial' | 'missed' | 'none' | 'today_pending' = 'none'
    let tooltip = 'No doses scheduled or recorded'

    const dayWasBeforePlan = planStartTime > 0 && endOfDay.getTime() < planStartTime

    if (dayWasBeforePlan) {
      status = 'none'
      tooltip = 'Before plan enrollment'
    } else if (totalCount === 0) {
      if (isToday) {
        status = 'today_pending'
        tooltip = 'Awaiting doses today'
      } else {
        status = 'none'
        tooltip = 'No activity recorded'
      }
    } else if (takenCount > 0 && missedCount === 0) {
      status = 'full'
      tooltip = `${takenCount} of ${totalCount} taken (100%)`
    } else if (takenCount > 0 && missedCount > 0) {
      status = 'partial'
      tooltip = `${takenCount} of ${totalCount} taken (${Math.round((takenCount / totalCount) * 100)}%)`
    } else {
      status = 'missed'
      tooltip = `0 of ${totalCount} taken (Missed)`
    }

    days.push({
      dateStr,
      dayLabel,
      takenCount,
      missedCount,
      totalScheduled: totalCount,
      status,
      tooltip,
    })
  }

  return days
}

/**
 * Computes per-medication adherence breakdowns to identify specific drug drop-offs.
 */
export function calculateMedicationAdherence(
  medications: Array<{ id?: string; name: string; dosage?: string | null }>,
  doseLogs: Array<{ feeling_tag?: string | null; notes?: string | null; taken: boolean }>
): MedicationAdherenceStat[] {
  return medications.map((med) => {
    const medNameLower = med.name.toLowerCase().trim()

    // Find all dose logs matching this medication by feeling_tag or notes
    const matchingLogs = doseLogs.filter((l) => {
      if (l.feeling_tag && l.feeling_tag.toLowerCase().includes(medNameLower)) {
        return true
      }
      if (l.notes && l.notes.toLowerCase().includes(medNameLower)) {
        return true
      }
      if (med.id && l.notes && l.notes.includes(`[MedId:${med.id}]`)) {
        return true
      }
      return false
    })

    const takenCount = matchingLogs.filter((l) => l.taken).length
    const missedCount = matchingLogs.filter((l) => !l.taken).length
    const totalCount = takenCount + missedCount

    if (totalCount === 0) {
      return {
        medId: med.id,
        medName: med.name,
        dosage: med.dosage || '',
        takenCount: 0,
        missedCount: 0,
        totalCount: 0,
        adherenceRate: null,
        status: 'awaiting',
        statusText: 'No logs yet',
      }
    }

    const rate = Math.round((takenCount / totalCount) * 100)
    let status: 'on_track' | 'warning' | 'critical' = 'on_track'
    let statusText = `${rate}% adherence (${takenCount}/${totalCount})`

    if (rate < 60) {
      status = 'critical'
      statusText = `High Risk: ${rate}% (${missedCount} missed)`
    } else if (rate < 80) {
      status = 'warning'
      statusText = `Attention: ${rate}% (${missedCount} missed)`
    }

    return {
      medId: med.id,
      medName: med.name,
      dosage: med.dosage || '',
      takenCount,
      missedCount,
      totalCount,
      adherenceRate: rate,
      status,
      statusText,
    }
  })
}

/**
 * Computes scheduled recovery check-in compliance (expected vs completed).
 */
export function calculateCheckInCompliance(
  schedule: string | null | undefined,
  planCreatedAt: string | null | undefined,
  checkInLogs: Array<{ logged_at: string }>
): CheckInComplianceResult {
  const cadence = parseCadence(schedule)
  const now = Date.now()
  const startTime = planCreatedAt ? new Date(planCreatedAt).getTime() : now
  const elapsedMs = Math.max(0, now - startTime)

  // Number of expected check-ins since plan start
  const expectedCount = Math.max(1, Math.floor(elapsedMs / cadence.intervalMs))
  const completedCount = checkInLogs.length
  const complianceRate = Math.min(100, Math.round((completedCount / expectedCount) * 100))

  const latestLog = checkInLogs[0]?.logged_at
  const statusInfo = evaluateCheckInStatus(schedule, latestLog, planCreatedAt)

  let statusText = `${completedCount} of ${expectedCount} check-ins submitted (${complianceRate}%)`
  if (statusInfo.isOverdue) {
    statusText = `Overdue by ${statusInfo.daysOverdue}d (${completedCount}/${expectedCount} submitted)`
  }

  return {
    completedCount,
    expectedCount,
    complianceRate,
    statusText,
    isOverdue: statusInfo.isOverdue,
  }
}
