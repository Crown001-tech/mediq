export type UserRole = 'patient' | 'doctor' | 'admin'

export interface UserProfile {
  id: string
  full_name: string
  role: UserRole
  verified?: boolean
  email?: string
  phone?: string | null
  specialty?: string | null
  license_number?: string | null
  clinic_affiliation?: string | null
  created_at?: string
  updated_at?: string
}

export interface JwtSessionPayload {
  sub?: string
  exp?: number
  email?: string
  [key: string]: any
}
