import { supabaseAdmin } from '../../config/supabase.js';
import { ProfileRecord } from '../../common/types/index.js';

export class IdentityModel {
  static async getProfileById(userId: string): Promise<ProfileRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    return data;
  }

  static async updateProfile(userId: string, updates: Partial<ProfileRecord>): Promise<ProfileRecord> {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }
    return data;
  }
}
