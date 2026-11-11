import { Router } from 'express';
import { CarePlansController } from './care-plans.controller.js';

const router = Router();

router.get('/', CarePlansController.getCarePlans);
router.post('/log-dose', CarePlansController.logDose);
router.get('/:id', CarePlansController.getCarePlanById);
router.patch('/:id', CarePlansController.updateCarePlan);
router.put('/:id', CarePlansController.updateCarePlan);

export default router;
