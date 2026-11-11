import { ProfileRecord } from '../../common/types/index.js';

export class IdentityView {
  static renderProfile(profile: ProfileRecord | null) {
    if (!profile) return { success: false, error: 'Profile not found' };
    return {
      success: true,
      profile,
    };
  }

  static renderMe(user: any, profile: ProfileRecord | null) {
    return {
      success: true,
      user,
      profile,
    };
  }
}
