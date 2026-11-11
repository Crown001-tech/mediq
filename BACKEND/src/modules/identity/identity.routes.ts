import { Router } from 'express';
import { IdentityController } from './identity.controller.js';
import { authenticate } from '../../common/middleware/auth.middleware.js';

const router = Router();

router.get('/me', authenticate, IdentityController.getMe);
router.get('/profile/:id', IdentityController.getProfileById);
router.patch('/profile', authenticate, IdentityController.updateMyProfile);

export default router;
