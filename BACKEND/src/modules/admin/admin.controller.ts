import { Request, Response } from 'express';
import { AdminModel } from './admin.model.js';
import { AdminView } from './admin.view.js';
import { sendError } from '../../common/utils/response.util.js';

export class AdminController {
  static async getPatientAssignments(req: Request, res: Response) {
    try {
      const assignments = await AdminModel.getPatientAssignments();
      return res.json(AdminView.renderAssignments(assignments));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async getReassignmentHistory(req: Request, res: Response) {
    try {
      const history = AdminModel.getReassignmentHistory();
      return res.json(AdminView.renderHistory(history));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async reassignPatient(req: Request, res: Response) {
    try {
      const { patientId, newDoctorId } = req.body;

      if (!patientId || !newDoctorId) {
        return sendError(res, 'patientId and newDoctorId are required', 400);
      }

      const result = await AdminModel.reassignPatient({
        ...req.body,
        adminId: (req as any).user?.id || req.body.adminId,
      });

      return res.json(AdminView.renderReassignResult(result));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async verifyDoctor(req: Request, res: Response) {
    try {
      const { doctorId, action } = req.body;

      if (!doctorId || !['approve', 'reject', 'revoke'].includes(action)) {
        return sendError(res, 'Invalid parameters (doctorId and valid action required)', 400);
      }

      const updatedProfile = await AdminModel.verifyDoctor(doctorId, action);
      return res.json(AdminView.renderVerifyDoctorResult(updatedProfile));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }
}
