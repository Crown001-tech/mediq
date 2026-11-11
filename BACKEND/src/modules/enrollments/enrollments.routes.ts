import { Router } from 'express';
import { EnrollmentsController } from './enrollments.controller.js';

const router = Router();

router.get('/verify', EnrollmentsController.verify);
router.get('/verify/:code', EnrollmentsController.verify);
router.post('/claim', EnrollmentsController.claim);

export default router;
