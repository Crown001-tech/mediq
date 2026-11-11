export type CaseSLAInfo = {
  targetHours: number
  slaLabel: string
  elapsedMs: number
  remainingMs: number
  isWarning: boolean
  isBreached: boolean
  timeRemainingStr: string
  overdueStr?: string
}

export type CaseItem = {
  id: string
  symptoms_description: string
  urgency: string
  status: string
  created_at: string
}

export type Case = {
  id: string
  patient_id: string
  doctor_id?: string | null
  symptoms_description: string
  duration?: string | null
  urgency: 'routine' | 'somewhat_urgent' | 'needs_live_call' | string
  status: 'pending' | 'in_review' | 'responded' | 'closed' | string
  created_at: string
  updated_at?: string
}

export type CasesListProps = {
  cases: CaseItem[]
}

export type UrgentZoneProps = {
  hospitalAlert?: string | null
  doseReminder?: string | null
}
