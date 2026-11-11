import { Request, Response } from 'express';
import { NotificationsModel } from './notifications.model.js';
import { NotificationsView } from './notifications.view.js';
import { sendError } from '../../common/utils/response.util.js';

export class NotificationsController {
  static async getNotifications(req: Request, res: Response) {
    try {
      const userId = (req.query.user_id as string) || (req as any).user?.id;

      if (!userId) {
        return res.json(NotificationsView.renderList([]));
      }

      const list = await NotificationsModel.fetchForUser(userId);
      return res.json(NotificationsView.renderList(list));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async createNotification(req: Request, res: Response) {
    try {
      const { user_id, message, title, type } = req.body;

      if (!user_id || !message) {
        return sendError(res, 'MISSING_FIELDS (user_id and message are required)', 400);
      }

      const created = await NotificationsModel.createNotification({
        user_id,
        title,
        message,
        type,
      });

      return res.status(201).json(NotificationsView.renderItem(created));
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }

  static async markAsRead(req: Request, res: Response) {
    try {
      const userId = req.body.user_id || (req as any).user?.id || (req.query.user_id as string);

      if (!userId) {
        return sendError(res, 'MISSING_USER_ID', 400);
      }

      await NotificationsModel.markAllAsRead(userId);
      return res.json({ success: true, message: 'All notifications marked as read' });
    } catch (err: any) {
      return sendError(res, err.message, 500);
    }
  }
}
