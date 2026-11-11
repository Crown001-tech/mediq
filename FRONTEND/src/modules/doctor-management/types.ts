export type PendingInvite = {
  id: string
  invite_code: string
  patient_name: string | null
  patient_phone: string | null
  initial_notes: string | null
  expires_at: string
  created_at: string
  status: string
}

export interface EnrollPatientModalProps {
  isOpen: boolean
  onClose: () => void
  doctorId: string
  doctorName: string
  doctorSpecialty?: string
  onEnrollmentCreated?: () => void
}

export type DoctorSidebarProps = {
  fullName: string
  specialty: string
  activePage?: string
}

export type DoctorBottomNavProps = {
  activePage?: string
}

export type DoctorDesktopHeaderProps = {
  fullName?: string
  specialty?: string
}
