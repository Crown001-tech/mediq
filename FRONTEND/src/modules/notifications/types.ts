export type NotificationItem = {
  id: string
  type: string
  title?: string | null
  message: string
  read: boolean
  created_at: string
}

export type SendNotificationParams = {
  userId: string
  title?: string
  message: string
  type: string
}
