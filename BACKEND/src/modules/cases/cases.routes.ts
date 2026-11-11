import { Router } from 'express';
import { CasesController } from './cases.controller.js';

const router = Router();

router.get('/', CasesController.getCases);
router.get('/:id', CasesController.getCaseById);
router.patch('/:id', CasesController.updateCase);
router.put('/:id', CasesController.updateCase);

export default router;
