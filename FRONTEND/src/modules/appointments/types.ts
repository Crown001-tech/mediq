export type AppointmentRecord = {
  id: string
  patient_id: string
  doctor_id: string
  case_id?: string | null
  cases_id?: string | null
  scheduled_at: string
  status: 'upcoming' | 'completed' | 'cancelled' | string
  type?: 'video' | 'in_person' | 'follow_up' | string
  reason?: string | null
  doctor_notes?: string | null
  video_room_token?: string | null
  doctor_name?: string
  doctor_specialty?: string
  patient_name?: string
  patient_phone?: string | null
  patient_gender?: string | null
  patient_age?: number | null
  created_at?: string
}

export type CreateAppointmentInput = {
  id?: string
  patient_id: string
  doctor_id: string
  case_id?: string | null
  cases_id?: string | null
  scheduled_at: string
  status?: string
  type?: string
  reason?: string | null
  video_room_token?: string | null
}

export type UpdateAppointmentInput = {
  status?: string
  doctor_notes?: string | null
}
