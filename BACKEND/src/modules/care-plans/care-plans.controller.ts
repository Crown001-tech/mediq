import { Request, Response } from 'express';
import { CarePlansModel } from './care-plans.model.js';
import { CarePlansView } from './care-plans.view.js';
import { sendError } from '../../common/utils/response.util.js';

export class CarePlansController {
  static async getCarePlans(req: Request, res: Response) {
    try {
      const patientId = req.query.patient_id as string | undefined;
      const doctorId = req.query.doctor_id as string | undefined;
      const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;

      const plans = await CarePlansModel.fetchCarePlans({
        patient_id: patientId,
        doctor_id: doctorId,
        active,
      });

      return res.json(CarePlansView.renderList(plans));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async getCarePlanById(req: Request, res: Response) {
    try {
      const id = req.params.id;
      const plan = await CarePlansModel.fetchById(id);
      if (!plan) {
        return res.status(404).json({ success: false, error: 'Care plan not found' });
      }
      return res.json(CarePlansView.renderItem(plan));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async updateCarePlan(req: Request, res: Response) {
    try {
      const id = req.params.id;
      const updated = await CarePlansModel.updateCarePlan(id, req.body);
      return res.json(CarePlansView.renderItem(updated));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async logDose(req: Request, res: Response) {
    try {
      const { care_plan_id, patient_id } = req.body;
      if (!care_plan_id || !patient_id) {
        return sendError(res, 'care_plan_id and patient_id are required', 400);
      }
      const logged = await CarePlansModel.logDose(req.body);
      return res.json({ success: true, log: logged });
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }
}
