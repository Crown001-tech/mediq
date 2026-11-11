import fs from 'fs';
import path from 'path';
import { supabase, supabaseAdmin } from '../../config/supabase.js';
import { formatDoctorName } from '../../common/utils/string.util.js';
import { resolveDataPath } from '../../common/utils/path.util.js';

const assignmentsFile = resolveDataPath('patient_doctor_assignments.json');

function saveAssignmentLocally(entry: {
  patient_id: string;
  doctor_id: string;
  doctor_name?: string;
  patient_name?: string;
  status: string;
  code?: string;
}) {
  try {
    let list: any[] = [];
    if (fs.existsSync(assignmentsFile)) {
      list = JSON.parse(fs.readFileSync(assignmentsFile, 'utf-8'));
    }
    list = list.filter((item) => item.patient_id !== entry.patient_id);
    list.push({ ...entry, updated_at: new Date().toISOString() });
    fs.writeFileSync(assignmentsFile, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save assignment locally:', err);
  }
}

export class EnrollmentsModel {
  /**
   * Verify whether an enrollment invite code is valid and available
   */
  static async verifyCode(rawCode: string) {
    const cleanCode = rawCode.trim().toUpperCase();

    // 1. Try atomic Postgres RPC
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('verify_enrollment_code', {
        p_code: cleanCode,
      });

      if (!rpcError && rpcData) {
        return rpcData;
      }
    } catch {
      // Fall through to resilient direct query
    }

    // 2. Direct Query Fallback
    let enrollment: any = null;
    let queryError: any = null;

    try {
      const res = await supabase
        .from('enrollments')
        .select('id, doctor_id, invite_code, status, patient_name, patient_phone, expires_at')
        .eq('invite_code', cleanCode)
        .maybeSingle();
      enrollment = res.data;
      queryError = res.error;
    } catch {
      const res = await supabase
        .from('enrollments')
        .select('id, doctor_id, invite_code, status, patient_name, expires_at')
        .eq('invite_code', cleanCode)
        .maybeSingle();
      enrollment = res.data;
      queryError = res.error;
    }

    if (queryError) {
      if (queryError.code === 'PGRST204' || queryError.message?.includes('does not exist') || queryError.message?.includes('schema cache')) {
        return {
          valid: false,
          reason: 'DATABASE_SETUP_REQUIRED',
          message: 'The enrollments table is not yet migrated in Supabase.',
        };
      }
      return { valid: false, reason: 'ERROR', error: queryError.message };
    }

    if (!enrollment) {
      return { valid: false, reason: 'NOT_FOUND' };
    }

    if (enrollment.status === 'active') {
      return { valid: false, reason: 'ALREADY_CLAIMED' };
    }

    if (enrollment.status !== 'pending') {
      return { valid: false, reason: 'INVALID_STATUS' };
    }

    if (enrollment.expires_at && new Date(enrollment.expires_at).getTime() < Date.now()) {
      return {
        valid: false,
        reason: 'EXPIRED',
        expires_at: enrollment.expires_at,
      };
    }

    let doctorName = 'Attending Physician';
    let doctorSpecialty = 'General Practice';

    if (enrollment.doctor_id) {
      const { data: doctorProfile } = await supabase
        .from('profiles')
        .select('full_name, specialty')
        .eq('id', enrollment.doctor_id)
        .maybeSingle();

      if (doctorProfile) {
        doctorName = doctorProfile.full_name || doctorName;
        doctorSpecialty = doctorProfile.specialty || doctorSpecialty;
      }
    }

    return {
      valid: true,
      code: enrollment.invite_code,
      doctor_id: enrollment.doctor_id,
      doctor_name: formatDoctorName(doctorName),
      doctor_specialty: doctorSpecialty,
      patient_name_hint: enrollment.patient_name || null,
      patient_phone_hint: enrollment.patient_phone || null,
      expires_at: enrollment.expires_at,
    };
  }

  /**
   * Claim an enrollment invite code and bind patient to doctor
   */
  static async claimCode(payload: { code: string; patient_id: string; patient_name?: string }) {
    const { code, patient_id, patient_name } = payload;
    const cleanCode = code.trim().toUpperCase();

    let claimed = false;
    let doctorId = '';
    let doctorName = 'Attending Physician';

    // 1. Try atomic Postgres RPC
    try {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('claim_enrollment_invite', {
        p_code: cleanCode,
        p_patient_id: patient_id,
      });

      if (!rpcError && rpcData && rpcData.success) {
        claimed = true;
        doctorId = rpcData.doctor_id;
        doctorName = rpcData.doctor_name || 'Attending Physician';
      }
    } catch {
      // Fall through to direct query
    }

    // 2. Direct Resilient Fallback
    if (!claimed) {
      const { data: enrollment } = await supabaseAdmin
        .from('enrollments')
        .select('id, doctor_id, status, expires_at')
        .eq('invite_code', cleanCode)
        .maybeSingle();

      if (enrollment) {
        doctorId = enrollment.doctor_id;

        if (enrollment.expires_at && new Date(enrollment.expires_at).getTime() < Date.now()) {
          throw new Error('EXPIRED');
        }

        const { error: updateErr } = await supabaseAdmin
          .from('enrollments')
          .update({
            patient_id,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id);

        if (!updateErr) {
          claimed = true;
        }

        if (enrollment.doctor_id) {
          const { data: docProfile } = await supabaseAdmin
            .from('profiles')
            .select('full_name')
            .eq('id', enrollment.doctor_id)
            .maybeSingle();
          if (docProfile?.full_name) doctorName = formatDoctorName(docProfile.full_name);
        }
      }
    }

    if (!claimed || !doctorId) {
      throw new Error('INVALID_CODE');
    }

    // Save to local file store
    saveAssignmentLocally({
      patient_id,
      doctor_id: doctorId,
      doctor_name: doctorName,
      patient_name: patient_name || 'Enrolled Patient',
      status: 'active',
      code: cleanCode,
    });

    // Send notifications
    try {
      await supabaseAdmin.from('notifications').insert([
        {
          user_id: doctorId,
          message: `New Patient Enrolled: ${patient_name || 'A patient'} registered with invite code ${cleanCode} and joined your active roster.`,
          type: 'enrollment',
          read: false,
        },
        {
          user_id: patient_id,
          message: `Doctor Connected: You are connected with ${formatDoctorName(doctorName)} for clinical post-encounter follow-up care.`,
          type: 'enrollment',
          read: false,
        },
      ]);
    } catch {
      // Non-blocking
    }

    return {
      success: true,
      doctor_id: doctorId,
      doctor_name: formatDoctorName(doctorName),
    };
  }
}
