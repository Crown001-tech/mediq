import { Request, Response } from 'express';
import { IdentityModel } from './identity.model.js';
import { IdentityView } from './identity.view.js';
import { AuthenticatedRequest } from '../../common/middleware/auth.middleware.js';
import { sendError } from '../../common/utils/response.util.js';

export class IdentityController {
  static async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return sendError(res, 'Unauthorized', 401);
      }
      return res.json(IdentityView.renderMe(req.user, req.userProfile || null));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async getProfileById(req: Request, res: Response) {
    try {
      const id = req.params.id;
      const profile = await IdentityModel.getProfileById(id);
      if (!profile) {
        return res.status(404).json({ success: false, error: 'Profile not found' });
      }
      return res.json(IdentityView.renderProfile(profile));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async updateMyProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return sendError(res, 'Unauthorized', 401);
      }
      const updated = await IdentityModel.updateProfile(req.user.id, req.body);
      return res.json(IdentityView.renderProfile(updated));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }
}
