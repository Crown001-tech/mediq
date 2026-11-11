import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../../config/supabase.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    [key: string]: any;
  };
  userProfile?: {
    id: string;
    role: string;
    verified?: boolean;
    full_name?: string;
    [key: string]: any;
  };
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    if (!token && req.headers.cookie) {
      const match = req.headers.cookie.match(/mediq-auth-token=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Missing authentication token' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired session' });
    }

    req.user = user;

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      req.userProfile = profile;
    }

    next();
  } catch (err: any) {
    return res.status(401).json({ success: false, error: 'Authentication error', details: err?.message });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.userProfile) {
      return res.status(403).json({ success: false, error: 'Forbidden: Profile not found' });
    }

    if (!roles.includes(req.userProfile.role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: Requires one of [${roles.join(', ')}] role`,
      });
    }

    next();
  };
}

export const requireAdmin = [authenticate, requireRole('admin')];
export const requireDoctor = [
  authenticate,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.userProfile || req.userProfile.role !== 'doctor') {
      return res.status(403).json({ success: false, error: 'Forbidden: Doctor access required' });
    }
    if (!req.userProfile.verified) {
      return res.status(403).json({ success: false, error: 'Forbidden: Doctor verification pending' });
    }
    next();
  },
];
