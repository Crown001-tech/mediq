export type SenderRole = 'doctor' | 'patient'

export type ThreadMessage = {
  id: string
  senderRole: SenderRole
  senderName: string
  message: string
  prescription?: string | null
  createdAt: string
  isLocalFallback?: boolean
}

export type ConsultationCaseSummary = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
  created_at: string
  doctor_id: string | null
}
