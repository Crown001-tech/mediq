export type MedicationDurationInfo = {
  durationText: string
  isCompleted: boolean
  currentDay: number
  totalDays: number | null
  progressText: string
}

export type CheckInStatus = {
  isOverdue: boolean
  daysOverdue: number
  cadenceLabel: string
  lastReportStr: string
}

export type AdherenceMetrics = {
  adherenceRate: number | null
  takenCount: number
  missedCount: number
  autoMissedCount: number
  lastLoggedStr: string
  isAwaitingFirstWindow: boolean
}

export type DayAdherenceSlot = {
  dateStr: string // YYYY-MM-DD
  dayLabel: string // "Mon 15", "Today", etc.
  takenCount: number
  missedCount: number
  totalScheduled: number
  status: 'full' | 'partial' | 'missed' | 'none' | 'today_pending'
  tooltip: string
}

export type MedicationAdherenceStat = {
  medId?: string
  medName: string
  dosage: string
  takenCount: number
  missedCount: number
  totalCount: number
  adherenceRate: number | null
  status: 'on_track' | 'warning' | 'critical' | 'awaiting'
  statusText: string
}

export type CheckInComplianceResult = {
  completedCount: number
  expectedCount: number
  complianceRate: number
  statusText: string
  isOverdue: boolean
}

export type PrintableMedication = {
  name: string
  form?: string
  dosage?: string | null
  route?: string | null
  frequency?: string | null
  schedule_times?: string | null
  duration?: string | null
  instructions?: string | null
}

export type CarePlan = {
  id: string
  cases_id: string
  patient_id: string
  doctor_id: string
  type: 'medication' | 'checkin' | string
  schedule: string
  details?: string | null
  created_at: string
}
