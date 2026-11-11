import { Request, Response } from 'express';
import { CasesModel } from './cases.model.js';
import { CasesView } from './cases.view.js';
import { sendError } from '../../common/utils/response.util.js';

export class CasesController {
  static async getCases(req: Request, res: Response) {
    try {
      const patientId = req.query.patient_id as string | undefined;
      const doctorId = req.query.doctor_id as string | undefined;
      const status = req.query.status as string | undefined;

      const cases = await CasesModel.fetchCases({
        patient_id: patientId,
        doctor_id: doctorId,
        status,
      });

      return res.json(CasesView.renderList(cases));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async getCaseById(req: Request, res: Response) {
    try {
      const id = req.params.id;
      const caseItem = await CasesModel.fetchById(id);
      if (!caseItem) {
        return res.status(404).json({ success: false, error: 'Case not found' });
      }
      return res.json(CasesView.renderItem(caseItem));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async updateCase(req: Request, res: Response) {
    try {
      const id = req.params.id;
      const updated = await CasesModel.updateCase(id, req.body);
      return res.json(CasesView.renderItem(updated));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }
}
