import { supabaseAdmin } from '../../config/supabase.js';
import { StoredAppointment } from '../../common/types/index.js';
import { formatDoctorName, generateVideoRoomToken } from '../../common/utils/string.util.js';

export class AppointmentsModel {
  /**
   * Fetch appointments for a specific patient or doctor with profile enrichment
   */
  static async fetchAppointments(filter: { patient_id?: string; doctor_id?: string }): Promise<StoredAppointment[]> {
    const { patient_id, doctor_id } = filter;
    if (!patient_id && !doctor_id) return [];

    let query = supabaseAdmin.from('appointments').select('*');
    if (patient_id) {
      query = query.eq('patient_id', patient_id);
    } else if (doctor_id) {
      query = query.eq('doctor_id', doctor_id);
    }

    const { data: dbData, error: dbErr } = await query.order('scheduled_at', { ascending: false });
    if (dbErr) {
      console.error('AppointmentsModel.fetchAppointments error:', dbErr.message);
      throw new Error(dbErr.message);
    }

    const rawList = dbData || [];
    const docIds = [...new Set(rawList.filter((a) => a.doctor_id).map((a) => a.doctor_id))];
    const patIds = [...new Set(rawList.filter((a) => a.patient_id).map((a) => a.patient_id))];

    const docMap: Record<string, { name: string; specialty: string }> = {};
    const patMap: Record<string, { name: string; phone: string | null }> = {};

    if (docIds.length > 0) {
      const { data: docs } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, specialty')
        .in('id', docIds);
      if (docs) {
        docs.forEach((d) => {
          docMap[d.id] = {
            name: formatDoctorName(d.full_name),
            specialty: d.specialty || 'General Practice',
          };
        });
      }
    }

    if (patIds.length > 0) {
      const { data: pats } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, phone')
        .in('id', patIds);
      if (pats) {
        pats.forEach((p) => {
          patMap[p.id] = {
            name: p.full_name || 'Patient',
            phone: p.phone || null,
          };
        });
      }
    }

    return rawList.map((row) => {
      let extractedToken = row.video_room_token || null;
      if (!extractedToken && row.doctor_notes) {
        const tokenMatch = row.doctor_notes.match(/\[RoomToken:([a-zA-Z0-9_-]+)\]/);
        if (tokenMatch) extractedToken = tokenMatch[1];
      }
      let cleanDocNotes = row.doctor_notes;
      if (cleanDocNotes) {
        cleanDocNotes = cleanDocNotes.replace(/\[RoomToken:[a-zA-Z0-9_-]+\]\s*/, '').trim() || null;
      }

      const docInfo = docMap[row.doctor_id];
      const patInfo = patMap[row.patient_id];

      return {
        id: row.id,
        patient_id: row.patient_id,
        doctor_id: row.doctor_id,
        case_id: row.case_id,
        cases_id: row.case_id,
        scheduled_at: row.scheduled_at,
        status: row.status,
        type: row.type || 'video',
        reason: row.reason || null,
        doctor_notes: cleanDocNotes,
        video_room_token: extractedToken,
        doctor_name: docInfo?.name || 'Attending Physician',
        doctor_specialty: docInfo?.specialty || 'General Practice',
        patient_name: patInfo?.name || 'Patient',
        patient_phone: patInfo?.phone || null,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || row.created_at || new Date().toISOString(),
      };
    });
  }

  /**
   * Create new appointment
   */
  static async createAppointment(input: {
    id?: string;
    patient_id: string;
    doctor_id: string;
    case_id?: string | null;
    cases_id?: string | null;
    scheduled_at: string;
    status?: string;
    type?: string;
    reason?: string | null;
    notes?: string | null;
    doctor_notes?: string | null;
    video_room_token?: string | null;
  }): Promise<StoredAppointment> {
    const {
      id,
      patient_id,
      doctor_id,
      case_id,
      cases_id,
      scheduled_at,
      status = 'upcoming',
      type = 'video',
      reason,
      notes,
      doctor_notes,
      video_room_token,
    } = input;

    const secureToken = video_room_token || generateVideoRoomToken();

    const insertPayload: Record<string, any> = {
      patient_id,
      doctor_id,
      case_id: case_id || cases_id || null,
      scheduled_at,
      status,
      type,
      reason: reason || null,
      doctor_notes: doctor_notes || notes || null,
      video_room_token: secureToken,
    };

    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      insertPayload.id = id;
    }

    const { data, error: insertErr } = await supabaseAdmin
      .from('appointments')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertErr) {
      console.error('AppointmentsModel.createAppointment error:', insertErr.message);
      throw new Error(insertErr.message);
    }

    const [docRes, patRes] = await Promise.allSettled([
      supabaseAdmin.from('profiles').select('full_name, specialty').eq('id', doctor_id).maybeSingle(),
      supabaseAdmin.from('profiles').select('full_name, phone').eq('id', patient_id).maybeSingle(),
    ]);

    const docData = docRes.status === 'fulfilled' ? docRes.value.data : null;
    const patData = patRes.status === 'fulfilled' ? patRes.value.data : null;

    return {
      id: data.id,
      patient_id: data.patient_id,
      doctor_id: data.doctor_id,
      case_id: data.case_id,
      cases_id: data.case_id,
      scheduled_at: data.scheduled_at,
      status: data.status,
      type: data.type,
      reason: data.reason,
      doctor_notes: data.doctor_notes,
      video_room_token: data.video_room_token,
      doctor_name: formatDoctorName(docData?.full_name),
      doctor_specialty: docData?.specialty || 'General Practice',
      patient_name: patData?.full_name || 'Patient',
      patient_phone: patData?.phone || null,
      created_at: data.created_at,
      updated_at: data.created_at,
    };
  }

  /**
   * Update appointment by ID
   */
  static async updateAppointment(id: string, updates: { status?: string; doctor_notes?: string; notes?: string }) {
    const updatePayload: Record<string, any> = {};
    if (updates.status !== undefined) updatePayload.status = updates.status;
    if (updates.doctor_notes !== undefined) updatePayload.doctor_notes = updates.doctor_notes;
    else if (updates.notes !== undefined) updatePayload.doctor_notes = updates.notes;

    const { data, error: patchErr } = await supabaseAdmin
      .from('appointments')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (patchErr) {
      console.error('AppointmentsModel.updateAppointment error:', patchErr.message);
      throw new Error(patchErr.message);
    }

    return data;
  }
}
