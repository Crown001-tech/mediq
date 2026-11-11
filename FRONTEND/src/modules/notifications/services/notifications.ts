import { SendNotificationParams } from '../types'
import { cleanDoctorText } from '@/shared/utils'

export async function sendNotification({ userId, title, message, type }: SendNotificationParams) {
  if (!userId || !message) return false

  const cleanTitle = title ? cleanDoctorText(title) : null
  const cleanMessage = cleanDoctorText(message)

  const notifObj = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    user_id: userId,
    title: cleanTitle,
    message: cleanMessage,
    type: type || 'general',
    read: false,
    created_at: new Date().toISOString(),
  }

  // 1. Dispatch to server-side notification relay API
  try {
    if (typeof window !== 'undefined') {
      fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          title: cleanTitle,
          message: cleanMessage,
          type: type || 'general',
        }),
      }).catch((e) => console.warn('Server notification relay warning:', e))
    }
  } catch {
    // Non-blocking
  }

  // 2. LocalStorage fallback
  try {
    const storageKey = `mediq_user_notifs_${userId}`
    const existing = JSON.parse(localStorage.getItem(storageKey) || '[]')
    existing.unshift(notifObj)
    localStorage.setItem(storageKey, JSON.stringify(existing.slice(0, 30)))
  } catch {
    // Ignore
  }

  // 3. In-browser instant custom event dispatch
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('mediq_notification', {
          detail: notifObj,
        })
      )
    }
  } catch {
    // Ignore
  }

  return true
}
