'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/shared/supabase'
import { NotificationBell } from '@/modules/notifications'
import { formatDoctorName } from '@/shared/utils'
import { DoctorDesktopHeaderProps } from '../types'

export default function DoctorDesktopHeader({ fullName: initialFullName, specialty }: DoctorDesktopHeaderProps) {
  const [fullName, setFullName] = useState(initialFullName || '')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('mediq_doctor_sidebar_collapsed') === 'true'
      setCollapsed(stored)
    } catch {}

    const handleToggle = (e: any) => {
      setCollapsed(e.detail?.collapsed ?? false)
    }
    window.addEventListener('mediq_doctor_sidebar_toggle', handleToggle)
    return () => window.removeEventListener('mediq_doctor_sidebar_toggle', handleToggle)
  }, [])

  useEffect(() => {
    if (initialFullName) {
      setFullName(initialFullName)
      return
    }

    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()

      if (profile?.full_name) {
        setFullName(profile.full_name)
      }
    }

    fetchProfile()
  }, [initialFullName])

  const getInitials = (name: string): string => {
    const clean = name.replace(/^Dr\.\s*/i, '').trim()
    if (!clean) return 'DR'
    const parts = clean.split(/\s+/)
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  const initials = getInitials(fullName)

  return (
    <header
      className={`hidden md:flex h-16 bg-white border-b border-border-subtle items-center justify-between px-8 fixed top-0 right-0 z-30 transition-all duration-300 ease-in-out ${
        collapsed ? 'left-20' : 'left-64'
      }`}
    >
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-primary">Doctor Workspace</h1>
        <span className="text-xs text-text-muted font-normal">|</span>
        <span className="text-xs text-text-muted">Clinical Operations</span>
      </div>

      <div className="flex items-center gap-4">
        {/* Notification Bell */}
        <NotificationBell />

        {/* Doctor Profile Mini-Pill */}
        <Link
          href="/doctor/profile"
          className="flex items-center gap-3 pl-2 pr-3 py-1.5 rounded-full hover:bg-surface-secondary border border-transparent hover:border-border-subtle transition-all cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-full bg-accent/10 text-accent font-bold text-xs flex items-center justify-center border border-accent/20">
            {initials}
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-primary leading-tight group-hover:text-accent transition-colors">
              {formatDoctorName(fullName)}
            </p>
            <p className="text-[10px] text-text-muted leading-tight">
              {specialty || 'General Practitioner'}
            </p>
          </div>
        </Link>
      </div>
    </header>
  )
}
