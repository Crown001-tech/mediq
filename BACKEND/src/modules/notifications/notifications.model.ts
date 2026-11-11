import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../../config/supabase.js';
import { NotificationRecord } from '../../common/types/index.js';
import { cleanDoctorText } from '../../common/utils/string.util.js';
import { resolveDataPath } from '../../common/utils/path.util.js';

const storeFile = resolveDataPath('notifications_store.json');

function getStoredNotifications(): any[] {
  try {
    if (fs.existsSync(storeFile)) {
      const raw = fs.readFileSync(storeFile, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading notifications store:', err);
  }
  return [];
}

export class NotificationsModel {
  /**
   * Fetch recent notifications for user with fallback to JSON store
   */
  static async fetchForUser(userId: string): Promise<NotificationRecord[]> {
    if (!userId) return [];

    let notifications: NotificationRecord[] = [];

    try {
      const { data: dbData, error: dbErr } = await supabaseAdmin
        .from('notifications')
        .select('id, type, message, read, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(40);

      if (dbErr) {
        console.warn('Supabase notifications fetch warning:', dbErr.message);
      } else if (dbData) {
        notifications = dbData.map((row) => ({
          ...row,
          user_id: userId,
          message: cleanDoctorText(row.message),
          title: null,
        }));
      }
    } catch (err) {
      console.warn('Database error while querying notifications:', err);
    }

    // Secondary fallback: if DB returned empty, check local file store
    if (notifications.length === 0) {
      const localStore = getStoredNotifications();
      for (const item of localStore) {
        if (item.user_id === userId) {
          notifications.push({
            id: item.id || `notif_${Date.now()}`,
            user_id: item.user_id,
            type: item.type || 'general',
            read: !!item.read,
            message: cleanDoctorText(item.message),
            title: item.title || null,
            created_at: item.created_at || new Date().toISOString(),
          });
        }
      }
      notifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return notifications.slice(0, 40);
  }

  /**
   * Insert new in-app notification
   */
  static async createNotification(payload: {
    user_id: string;
    title?: string | null;
    message: string;
    type?: string;
  }): Promise<NotificationRecord> {
    const { user_id, title, message, type = 'general' } = payload;

    const combinedText = title ? `${title}: ${message}` : message;
    const cleanMsg = cleanDoctorText(combinedText);

    const { data, error: insertErr } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_id,
        message: cleanMsg,
        type,
        read: false,
      })
      .select('*')
      .single();

    if (insertErr) {
      console.error('NotificationsModel.createNotification error:', insertErr.message);
      throw new Error(insertErr.message);
    }

    return {
      id: data.id,
      user_id: data.user_id,
      type: data.type,
      message: data.message,
      title: title || null,
      read: data.read,
      created_at: data.created_at,
    };
  }

  /**
   * Mark all notifications as read for a given user
   */
  static async markAllAsRead(userId: string): Promise<boolean> {
    const { error: updateErr } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (updateErr) {
      console.error('NotificationsModel.markAllAsRead error:', updateErr.message);
      throw new Error(updateErr.message);
    }

    return true;
  }
}
