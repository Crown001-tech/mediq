import { Router } from 'express';
import { NotificationsController } from './notifications.controller.js';

const router = Router();

router.get('/', NotificationsController.getNotifications);
router.post('/', NotificationsController.createNotification);
router.patch('/', NotificationsController.markAsRead);
router.put('/read', NotificationsController.markAsRead);

export default router;
