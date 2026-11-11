export type UserRole = 'admin' | 'doctor' | 'patient' | 'rejected' | string;

export interface ProfileRecord {
  id: string;
  email?: string;
  full_name?: string;
  role: UserRole;
  phone?: string | null;
  specialty?: string | null;
  verified?: boolean;
  license_number?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StoredAppointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  case_id?: string | null;
  cases_id?: string | null;
  scheduled_at: string;
  status: 'upcoming' | 'completed' | 'cancelled' | string;
  type: 'video' | 'in_person' | 'follow_up' | string;
  reason?: string | null;
  notes?: string | null;
  doctor_notes?: string | null;
  video_room_token?: string | null;
  doctor_name?: string;
  doctor_specialty?: string;
  patient_name?: string;
  patient_phone?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  message: string;
  title?: string | null;
  read: boolean;
  created_at: string;
}

export interface PatientAssignment {
  patient_id: string;
  doctor_id: string;
  patient_name?: string;
  doctor_name?: string;
  status: string;
  code?: string;
  updated_at?: string;
}

export interface ReassignmentRecord {
  id: string;
  patient_id: string;
  patient_name: string;
  old_doctor_id: string | null;
  old_doctor_name: string;
  new_doctor_id: string;
  new_doctor_name: string;
  notes: string;
  admin_id: string;
  created_at: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  [key: string]: any;
}
