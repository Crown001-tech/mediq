import { supabase } from '@/shared/supabase'
import { AppointmentRecord, CreateAppointmentInput, UpdateAppointmentInput } from '../types'

/**
 * Generate a cryptographically secure 32+ character video room token
 */
export function generateVideoRoomToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return (crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')).slice(0, 36)
  }
  return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 36)
}

/**
 * Construct secure, unguessable Jitsi room name using the full UUID and secondary token
 */
export function getJitsiRoomName(appointmentId: string, videoRoomToken?: string | null): string {
  const token = videoRoomToken ? `-${videoRoomToken}` : ''
  return `mediq-${appointmentId}${token}`
}

/**
 * Construct full Jitsi Meet URL
 */
export function getJitsiUrl(appointmentId: string, videoRoomToken?: string | null): string {
  return `https://meet.jit.si/${getJitsiRoomName(appointmentId, videoRoomToken)}`
}

/**
 * Fetch patient appointments directly from Supabase backend table
 */
export async function fetchPatientAppointments(patientId: string): Promise<AppointmentRecord[]> {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, patient_id, doctor_id, case_id, scheduled_at, status, type, reason, doctor_notes, video_room_token, created_at')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false })

    if (error) {
      console.error('Supabase fetchPatientAppointments error:', error.message)
      return []
    }

    return (data || []).map((row) => ({
      ...row,
      cases_id: row.case_id,
    }))
  } catch (err) {
    console.error('fetchPatientAppointments error:', err)
    return []
  }
}

/**
 * Fetch doctor appointments directly from Supabase backend table
 */
export async function fetchDoctorAppointments(doctorId: string): Promise<AppointmentRecord[]> {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, patient_id, doctor_id, case_id, scheduled_at, status, type, reason, doctor_notes, video_room_token, created_at')
      .eq('doctor_id', doctorId)
      .order('scheduled_at', { ascending: true })

    if (error) {
      console.error('Supabase fetchDoctorAppointments error:', error.message)
      return []
    }

    return (data || []).map((row) => ({
      ...row,
      cases_id: row.case_id,
    }))
  } catch (err) {
    console.error('fetchDoctorAppointments error:', err)
    return []
  }
}

/**
 * Create an appointment directly in the Supabase backend appointments table
 */
export async function createAppointmentInSupabase(appt: CreateAppointmentInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const caseId = appt.case_id || appt.cases_id || null

  const payload: any = {
    patient_id: appt.patient_id,
    doctor_id: appt.doctor_id,
    case_id: caseId,
    scheduled_at: appt.scheduled_at,
    status: appt.status || 'upcoming',
    type: appt.type || 'video',
    reason: appt.reason || null,
    video_room_token: appt.video_room_token || generateVideoRoomToken(),
  }

  // Only assign ID if valid UUID or let Supabase default gen_random_uuid() generate it
  if (appt.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appt.id)) {
    payload.id = appt.id
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert(payload)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Supabase createAppointment error:', error.message)
    return { success: false, error: error.message }
  }

  return { success: true, id: data?.id || appt.id }
}

/**
 * Update appointment status in Supabase backend
 */
export async function updateAppointmentInSupabase(
  id: string,
  updates: UpdateAppointmentInput
): Promise<{ success: boolean; error?: string }> {
  const payload: any = {}
  if (updates.status) payload.status = updates.status
  if (updates.doctor_notes !== undefined) payload.doctor_notes = updates.doctor_notes

  const { error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', id)

  if (error) {
    console.error('Supabase updateAppointment error:', error.message)
    return { success: false, error: error.message }
  }

  return { success: true }
}
