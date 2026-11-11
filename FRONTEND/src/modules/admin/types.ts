export type DoctorAdminProfile = {
  id: string
  full_name: string
  specialty: string | null
  bio: string | null
  phone: string | null
  created_at: string
  verified: boolean
}

export type PatientAdminProfile = {
  id: string
  full_name: string
  phone: string | null
  date_of_birth: string | null
  age: number | null
  gender: string | null
  created_at: string
}

export type CaseAuditItem = {
  id: string
  symptoms_description: string
  urgency: string
  status: string
  created_at: string
  patient_id: string
  doctor_id: string | null
}

export type ReassignmentAuditItem = {
  id: string
  patient_id: string
  patient_name: string
  old_doctor_id: string | null
  old_doctor_name: string
  new_doctor_id: string
  new_doctor_name: string
  reason?: string | null
  performed_by: string
  created_at: string
}
