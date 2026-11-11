'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/shared/supabase'
import { cleanDoctorText } from '@/shared/utils'
import { NotificationItem } from '../types'

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = useCallback(async (uid: string) => {
    let remoteList: NotificationItem[] = []

    // 1. Fetch from server notification relay (merges server store & database)
    try {
      const res = await fetch(`/api/notifications?user_id=${encodeURIComponent(uid)}`)
      if (res.ok) {
        const json = await res.json()
        if (json?.notifications) {
          remoteList = json.notifications as NotificationItem[]
        }
      }
    } catch {
      // Fallback to direct supabase query
    }

    // 2. Direct Supabase query (without non-existent title column)
    if (remoteList.length === 0) {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('id, type, message, read, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(25)

        if (!error && data) {
          remoteList = data as NotificationItem[]
        }
      } catch {
        // Non-blocking
      }
    }

    // 3. Merge with local storage fallback notifications
    try {
      const localKey = `mediq_user_notifs_${uid}`
      const localList: NotificationItem[] = JSON.parse(localStorage.getItem(localKey) || '[]')
      for (const item of localList) {
        if (!remoteList.some((r) => r.id === item.id || (r.message === item.message && Math.abs(new Date(r.created_at).getTime() - new Date(item.created_at).getTime()) < 5000))) {
          remoteList.push(item)
        }
      }
    } catch {
      // Non-blocking
    }

    remoteList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setNotifications(remoteList.slice(0, 25))
  }, [])

  // ── Load notifications + realtime + 10s auto-polling ─────────────────────
  useEffect(() => {
    let isMounted = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    let pollTimer: NodeJS.Timeout | null = null

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !isMounted) return
      setUserId(user.id)

      await fetchNotifications(user.id)

      if (!isMounted) return

      // 1. Resilient Polling Fallback (Every 10 seconds)
      pollTimer = setInterval(() => {
        if (isMounted) {
          fetchNotifications(user.id)
        }
      }, 10000)

      // 2. Supabase Realtime Subscription
      try {
        channel = supabase
          .channel(`notifications:${user.id}:${Date.now()}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              if (!isMounted) return
              const newNotif = payload.new as NotificationItem
              setNotifications((prev) => {
                if (prev.some((n) => n.id === newNotif.id)) return prev
                return [newNotif, ...prev].slice(0, 25)
              })
            }
          )
          .subscribe()
      } catch {
        // Non-blocking if realtime not enabled
      }
    }

    init()

    // 3. Custom Event Listener for instant same-session notification reflection
    const handleCustomNotif = (e: Event) => {
      const customEvent = e as CustomEvent<NotificationItem>
      if (customEvent.detail) {
        setNotifications((prev) => [customEvent.detail, ...prev].slice(0, 25))
      }
    }
    window.addEventListener('mediq_notification', handleCustomNotif)

    return () => {
      isMounted = false
      if (pollTimer) clearInterval(pollTimer)
      if (channel) supabase.removeChannel(channel)
      window.removeEventListener('mediq_notification', handleCustomNotif)
    }
  }, [fetchNotifications])

  // ── Close panel on outside click ─────────────────────────────────────────
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const unreadCount = notifications.filter((n) => !n.read).length

  const markAllRead = async () => {
    if (!userId || unreadCount === 0) return
    // Update server store
    try {
      fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      }).catch(() => { })
    } catch {
      // Non-blocking
    }

    // Update Supabase
    try {
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false)
    } catch {
      // Non-blocking
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const iconForType = (type: string) => {
    switch (type) {
      case 'hospital_alert': return 'emergency'
      case 'dose_reminder': return 'medication'
      case 'care_plan':
      case 'care_plan_created':
      case 'care_plan_updated': return 'clinical_notes'
      case 'discharge': return 'task_alt'
      case 'case_reply':
      case 'case_response': return 'chat'
      case 'enrollment': return 'person_add'
      case 'assignment': return 'swap_horiz'
      default: return 'notifications'
    }
  }

  const colorForType = (type: string) => {
    switch (type) {
      case 'hospital_alert': return 'text-red-600 bg-red-100/60'
      case 'discharge': return 'text-emerald-700 bg-emerald-100/70'
      case 'dose_reminder': return 'text-accent bg-accent/15'
      case 'care_plan':
      case 'care_plan_created':
      case 'care_plan_updated': return 'text-accent bg-accent/15'
      case 'case_reply':
      case 'case_response': return 'text-blue-600 bg-blue-100/60'
      default: return 'text-primary bg-surface-secondary'
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => {
          setOpen(!open)
          if (!open && unreadCount > 0) markAllRead()
        }}
        className="text-text-muted hover:bg-surface-secondary rounded-full p-2 transition-colors relative cursor-pointer"
        aria-label="Notifications"
        title="View Notifications"
      >
        <span className="material-symbols-outlined text-[22px]">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[10px] font-bold rounded-full border-2 border-white flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 sm:right-0 mt-2 w-[calc(100vw-32px)] sm:w-88 max-w-sm bg-white border border-border-subtle rounded-2xl shadow-xl z-50 max-h-[440px] flex flex-col animate-in fade-in zoom-in-95 duration-150">
          <div className="p-3.5 border-b border-border-subtle flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-xs rounded-t-2xl z-10">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-primary">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] font-semibold text-accent hover:underline cursor-pointer"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="overflow-y-auto divide-y divide-border-subtle flex-1">
            {notifications.length === 0 ? (
              <div className="p-8 flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-surface-secondary flex items-center justify-center text-text-muted">
                  <span className="material-symbols-outlined text-2xl">notifications_none</span>
                </div>
                <h4 className="text-xs font-bold text-primary mt-1">All Caught Up</h4>
                <p className="text-xs text-text-muted max-w-[200px]">
                  Clinical updates, check-in reminders, and doctor notes will appear here.
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-3.5 flex items-start gap-3 transition-colors hover:bg-surface-secondary/50 ${!n.read ? 'bg-emerald-50/30' : ''
                    }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${colorForType(
                      n.type
                    )}`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {iconForType(n.type)}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    {n.title && (
                      <h5 className="text-xs font-bold text-primary mb-0.5 leading-snug">
                        {cleanDoctorText(n.title)}
                      </h5>
                    )}
                    <p className="text-xs text-primary leading-relaxed">{cleanDoctorText(n.message)}</p>
                    <p className="text-[10px] text-text-muted mt-1 font-medium">
                      {new Date(n.created_at).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>

                  {!n.read && (
                    <span className="w-2 h-2 bg-accent rounded-full shrink-0 mt-1.5 shadow-xs" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
