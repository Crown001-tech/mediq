import { supabaseAdmin } from '../../config/supabase.js';

export class CasesModel {
  /**
   * Fetch cases by patient or doctor ID
   */
  static async fetchCases(filter: { patient_id?: string; doctor_id?: string; status?: string }) {
    let query = supabaseAdmin.from('cases').select('*');

    if (filter.patient_id) {
      query = query.eq('patient_id', filter.patient_id);
    }
    if (filter.doctor_id) {
      query = query.eq('doctor_id', filter.doctor_id);
    }
    if (filter.status) {
      query = query.eq('status', filter.status);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      throw new Error(error.message);
    }
    return data || [];
  }

  /**
   * Fetch single case with doctor and patient profiles
   */
  static async fetchById(caseId: string) {
    const { data, error } = await supabaseAdmin
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    return data;
  }

  /**
   * Update case status or metadata
   */
  static async updateCase(caseId: string, updates: Record<string, any>) {
    const { data, error } = await supabaseAdmin
      .from('cases')
      .update(updates)
      .eq('id', caseId)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    return data;
  }
}
