import { Request, Response } from 'express';
import { AppointmentsModel } from './appointments.model.js';
import { AppointmentsView } from './appointments.view.js';
import { sendError } from '../../common/utils/response.util.js';

export class AppointmentsController {
  static async getAppointments(req: Request, res: Response) {
    try {
      const patientId = req.query.patient_id as string | undefined;
      const doctorId = req.query.doctor_id as string | undefined;

      if (!patientId && !doctorId) {
        return res.json(AppointmentsView.renderList([]));
      }

      const list = await AppointmentsModel.fetchAppointments({
        patient_id: patientId,
        doctor_id: doctorId,
      });

      return res.json(AppointmentsView.renderList(list));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async createAppointment(req: Request, res: Response) {
    try {
      const { patient_id, doctor_id, scheduled_at } = req.body;

      if (!patient_id || !doctor_id || !scheduled_at) {
        return sendError(res, 'MISSING_REQUIRED_FIELDS (patient_id, doctor_id, scheduled_at)', 400);
      }

      const created = await AppointmentsModel.createAppointment(req.body);
      return res.status(201).json(AppointmentsView.renderItem(created));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async updateAppointment(req: Request, res: Response) {
    try {
      const id = req.body.id || req.params.id;
      if (!id) {
        return sendError(res, 'MISSING_ID', 400);
      }

      const updated = await AppointmentsModel.updateAppointment(id, req.body);
      return res.json({ success: true, appointment: updated });
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }
}
