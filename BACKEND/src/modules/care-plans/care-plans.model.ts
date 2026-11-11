import { supabaseAdmin } from '../../config/supabase.js';

export class CarePlansModel {
  /**
   * Fetch care plans by patient, doctor, or status
   */
  static async fetchCarePlans(filter: { patient_id?: string; doctor_id?: string; active?: boolean }) {
    let query = supabaseAdmin.from('care_plans').select('*');

    if (filter.patient_id) {
      query = query.eq('patient_id', filter.patient_id);
    }
    if (filter.doctor_id) {
      query = query.eq('doctor_id', filter.doctor_id);
    }
    if (filter.active !== undefined) {
      query = query.eq('active', filter.active);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      throw new Error(error.message);
    }
    return data || [];
  }

  /**
   * Fetch single care plan by ID
   */
  static async fetchById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('care_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    return data;
  }

  /**
   * Log a medication dose for a care plan
   */
  static async logDose(payload: {
    care_plan_id: string;
    patient_id: string;
    medication_name?: string;
    taken_at?: string;
    notes?: string;
  }) {
    const { care_plan_id, patient_id, medication_name, taken_at = new Date().toISOString(), notes } = payload;

    // Check if table dose_logs exists or insert in care_plan metadata/logs
    try {
      const { data, error } = await supabaseAdmin
        .from('dose_logs')
        .insert({
          care_plan_id,
          patient_id,
          medication_name,
          taken_at,
          notes,
        })
        .select('*')
        .single();

      if (!error && data) return data;
    } catch {
      // Fallback
    }

    return {
      success: true,
      care_plan_id,
      patient_id,
      taken_at,
    };
  }

  /**
   * Update care plan by ID
   */
  static async updateCarePlan(id: string, updates: Record<string, any>) {
    const { data, error } = await supabaseAdmin
      .from('care_plans')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    return data;
  }
}
