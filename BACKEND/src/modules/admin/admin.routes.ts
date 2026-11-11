import { Router } from 'express';
import { AdminController } from './admin.controller.js';
import { requireAdmin } from '../../common/middleware/auth.middleware.js';

const router = Router();

// In mediq, frontend admin pages call these endpoints either with Bearer token or cookie
router.get('/patient-assignments', AdminController.getPatientAssignments);
router.get('/reassign', AdminController.getReassignmentHistory);
router.post('/reassign', AdminController.reassignPatient);
router.post('/verify-doctor', AdminController.verifyDoctor);

export default router;
