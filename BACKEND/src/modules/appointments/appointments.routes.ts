import { Router } from 'express';
import { AppointmentsController } from './appointments.controller.js';

const router = Router();

router.get('/', AppointmentsController.getAppointments);
router.post('/', AppointmentsController.createAppointment);
router.patch('/', AppointmentsController.updateAppointment);
router.put('/', AppointmentsController.updateAppointment);
router.patch('/:id', AppointmentsController.updateAppointment);
router.put('/:id', AppointmentsController.updateAppointment);

export default router;
