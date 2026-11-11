import { NotificationRecord } from '../../common/types/index.js';

export class NotificationsView {
  static renderList(notifications: NotificationRecord[]) {
    return {
      success: true,
      notifications,
      total: notifications.length,
    };
  }

  static renderItem(notification: NotificationRecord) {
    return {
      success: true,
      notification,
    };
  }
}
