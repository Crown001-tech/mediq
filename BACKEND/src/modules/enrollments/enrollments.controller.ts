import { Request, Response } from 'express';
import { EnrollmentsModel } from './enrollments.model.js';
import { EnrollmentsView } from './enrollments.view.js';
import { sendError } from '../../common/utils/response.util.js';

export class EnrollmentsController {
  static async verify(req: Request, res: Response) {
    try {
      const code = (req.query.code as string) || (req.params.code as string);

      if (!code || !code.trim()) {
        return res.status(400).json({ valid: false, reason: 'MISSING_CODE' });
      }

      const result = await EnrollmentsModel.verifyCode(code);
      if (result.reason === 'DATABASE_SETUP_REQUIRED') {
        return res.status(503).json(result);
      }

      return res.json(EnrollmentsView.renderVerifyResult(result));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async claim(req: Request, res: Response) {
    try {
      const { code, patient_id, patient_name } = req.body;

      if (!code || !patient_id) {
        return sendError(res, 'MISSING_FIELDS (code and patient_id are required)', 400);
      }

      const result = await EnrollmentsModel.claimCode({
        code,
        patient_id,
        patient_name,
      });

      return res.json(EnrollmentsView.renderClaimResult(result));
    } catch (err: any) {
      if (err.message === 'INVALID_CODE' || err.message === 'EXPIRED') {
        return res.status(400).json({ success: false, error: err.message });
      }
      return sendError(res, err.message, 500);
    }
  }
}
