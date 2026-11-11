'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/shared/supabase'
import { NotificationBell } from '@/modules/notifications'
import { formatDoctorName } from '@/shared/utils'

export type DesktopHeaderProps = {
  fullName?: string
}

function getInitials(name: string): string {
  if (!name.trim()) return 'PT'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function DesktopHeader({ fullName: initialFullName }: DesktopHeaderProps) {
  const [fullName, setFullName] = useState(initialFullName || '')
  const [assignedDoctorName, setAssignedDoctorName] = useState<string>('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('mediq_sidebar_collapsed') === 'true'
      setCollapsed(stored)
    } catch {}

    const handleToggle = (e: any) => {
      setCollapsed(e.detail?.collapsed ?? false)
    }
    window.addEventListener('mediq_sidebar_toggle', handleToggle)
    return () => window.removeEventListener('mediq_sidebar_toggle', handleToggle)
  }, [])

  useEffect(() => {
    // 1. Check local storage cache
    const cachedName = localStorage.getItem('mediq_assigned_doctor_name')
    if (cachedName) setAssignedDoctorName(formatDoctorName(cachedName))

    // 2. Fetch from active enrollment / assignments
    const resolveAttendingDoc = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      try {
        const { data: enroll } = await supabase
          .from('enrollments')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (enroll?.doctor_id) {
          const { data: docProf } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', enroll.doctor_id)
            .maybeSingle()
          if (docProf?.full_name) {
            const formatted = formatDoctorName(docProf.full_name)
            setAssignedDoctorName(formatted)
            localStorage.setItem('mediq_assigned_doctor_name', formatted)
            return
          }
        }
      } catch {}

      try {
        const { data: cp } = await supabase
          .from('care_plans')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (cp?.doctor_id) {
          const { data: docProf } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', cp.doctor_id)
            .maybeSingle()
          if (docProf?.full_name) {
            const formatted = formatDoctorName(docProf.full_name)
            setAssignedDoctorName(formatted)
            localStorage.setItem('mediq_assigned_doctor_name', formatted)
            return
          }
        }
      } catch {}

      try {
        const { data: cs } = await supabase
          .from('cases')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .not('doctor_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (cs?.doctor_id) {
          const { data: docProf } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', cs.doctor_id)
            .maybeSingle()
          if (docProf?.full_name) {
            const formatted = formatDoctorName(docProf.full_name)
            setAssignedDoctorName(formatted)
            localStorage.setItem('mediq_assigned_doctor_name', formatted)
            return
          }
        }
      } catch {}
    }

    resolveAttendingDoc()
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
        .maybeSingle()

      if (profile?.full_name) {
        setFullName(profile.full_name)
      }
    }

    fetchProfile()
  }, [initialFullName])

  const initials = getInitials(fullName)

  return (
    <header
      className={`hidden md:flex ${
        collapsed ? 'md:ml-20' : 'md:ml-64'
      } sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-border-subtle justify-between items-center h-16 px-4 sm:px-6 lg:px-8 transition-all duration-300 ease-in-out`}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-xs font-medium text-text-muted hidden sm:inline">
            Telehealth Network Online
          </span>
          <span className="text-xs font-medium text-text-muted sm:hidden">
            Online
          </span>
        </div>
        {assignedDoctorName && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/25 text-accent text-xs font-semibold min-w-0">
            <span className="material-symbols-outlined text-[15px] shrink-0">stethoscope</span>
            <span className="truncate max-w-[130px] md:max-w-[180px] lg:max-w-[260px]">
              Attending: {formatDoctorName(assignedDoctorName)}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3.5 shrink-0">
        <NotificationBell />

        <div className="h-4 w-px bg-border-subtle" />

        <Link
          href="/profile"
          className="flex items-center gap-2 p-1 pl-2.5 rounded-full bg-surface-secondary/70 hover:bg-surface-secondary border border-border-subtle transition-all group cursor-pointer shrink-0"
          title="Patient Profile & Settings"
        >
          <span className="text-xs font-semibold text-primary group-hover:text-accent transition-colors hidden sm:inline max-w-[120px] md:max-w-[150px] truncate">
            {fullName || 'Patient Profile'}
          </span>
          <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shadow-xs shrink-0">
            {initials}
          </div>
        </Link>
      </div>
    </header>
  )
}
