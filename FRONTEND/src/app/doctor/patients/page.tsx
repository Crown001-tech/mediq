'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'
import EnrollPatientModal from '@/components/doctor/EnrollPatientModal'

export type PatientItem = {
  id: string
  name: string
  initials: string
  caseCount: number
  activeCount: number
  primaryConcern: string
  lastInteraction: string
  latestStatus: string
  timestamp: number
  isEnrolledDirect?: boolean
  isCheckInOverdue?: boolean
  adherencePercent?: number | null
  isCompleted?: boolean
}

function getInitials(name: string): string {
  if (!name) return 'PT'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatLastInteraction(dateStr: string): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)

  if (
    diffHours < 24 &&
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  ) {
    return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'completed':
      return {
        label: 'Discharged / Completed',
        className: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
        dotColor: 'bg-emerald-600',
      }
    case 'enrolled':
      return {
        label: 'Enrolled',
        className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        dotColor: 'bg-emerald-600',
      }
    case 'in_review':
      return {
        label: 'In Review',
        className: 'bg-[#FFF4E5] text-[#B26B00] border border-[#FFE2B8]',
        dotColor: 'bg-[#B26B00]',
      }
    case 'responded':
      return {
        label: 'Responded',
        className: 'bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]',
        dotColor: 'bg-[#2E7D32]',
      }
    case 'pending':
      return {
        label: 'Pending Review',
        className: 'bg-surface-secondary text-text-muted border border-border-subtle',
        dotColor: 'bg-text-muted',
      }
    case 'closed':
      return {
        label: 'Closed',
        className: 'bg-gray-100 text-gray-500 border border-gray-200',
        dotColor: 'bg-gray-400',
      }
    default:
      return {
        label: status.replace('_', ' '),
        className: 'bg-surface-secondary text-text-muted border border-border-subtle',
        dotColor: 'bg-text-muted',
      }
  }
}

export type FilterType = 'all' | 'overdue' | 'high_risk' | 'on_track' | 'active' | 'completed'
export type SortOption = 'risk_first' | 'recent' | 'adherence_asc' | 'adherence_desc' | 'name'

export default function MyPatientsPage() {
  const [doctorId, setDoctorId] = useState('')
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [patients, setPatients] = useState<PatientItem[]>([])
  const [pendingInvitesCount, setPendingInvitesCount] = useState(0)
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortOption>('risk_first')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const loadPatients = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    setDoctorId(user.id)

    // 1. Load doctor profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, specialty, role, verified')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || profile.role !== 'doctor' || !profile.verified) {
      router.push('/login')
      return
    }

    setFullName(profile.full_name || '')
    setSpecialty(profile.specialty || '')

    // 2. Fetch pending invites count
    try {
      const { count: pendingCount } = await supabase
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('doctor_id', user.id)
        .eq('status', 'pending')

      setPendingInvitesCount(pendingCount || 0)
    } catch {
      setPendingInvitesCount(0)
    }

    // 3. Load active & completed enrollments
    let activeEnrollments: any[] = []
    try {
      const { data: enrollData } = await supabase
        .from('enrollments')
        .select('patient_id, invite_code, initial_notes, enrolled_at, created_at, status')
        .eq('doctor_id', user.id)
        .in('status', ['active', 'completed'])
        .not('patient_id', 'is', null)

      if (enrollData) activeEnrollments = enrollData
    } catch {
      // Table may not be migrated yet
    }

    // 4. Load care plans prescribed by this doctor
    let doctorCarePlans: any[] = []
    try {
      const { data: planData } = await supabase
        .from('care_plans')
        .select('patient_id, type, details, schedule, created_at, active')
        .eq('doctor_id', user.id)

      if (planData) doctorCarePlans = planData
    } catch {
      // Graceful fallback
    }

    // 5. Load real cases assigned to or handled by this doctor
    const { data: cases } = await supabase
      .from('cases')
      .select('id, patient_id, status, created_at, symptoms_description')
      .eq('doctor_id', user.id)
      .order('created_at', { ascending: false })

    // 6. Aggregate patient IDs
    type PatientSummary = {
      caseCount: number
      activeCount: number
      latestSymptoms: string
      latestStatus: string
      latestCreatedAt: string
      timestamp: number
      isEnrolledDirect: boolean
      isCompleted: boolean
    }

    const summaryMap = new Map<string, PatientSummary>()

    // Add cases
    if (cases && cases.length > 0) {
      for (const c of cases) {
        if (!c.patient_id) continue
        const isActive = c.status === 'pending' || c.status === 'in_review'
        const caseTime = new Date(c.created_at).getTime()
        const existing = summaryMap.get(c.patient_id)

        if (existing) {
          existing.caseCount += 1
          if (isActive) existing.activeCount += 1
        } else {
          summaryMap.set(c.patient_id, {
            caseCount: 1,
            activeCount: isActive ? 1 : 0,
            latestSymptoms: c.symptoms_description || 'General Medical Consultation',
            latestStatus: c.status,
            latestCreatedAt: c.created_at,
            timestamp: caseTime,
            isEnrolledDirect: false,
            isCompleted: false,
          })
        }
      }
    }

    // Add care plans
    for (const cp of doctorCarePlans) {
      if (!cp.patient_id) continue
      const existing = summaryMap.get(cp.patient_id)
      const planTime = new Date(cp.created_at).getTime()

      if (existing) {
        if (cp.active && existing.activeCount === 0) existing.activeCount = 1
      } else {
        summaryMap.set(cp.patient_id, {
          caseCount: 0,
          activeCount: cp.active ? 1 : 0,
          latestSymptoms: `Care Plan: ${cp.type || 'Prescribed Regimen'}`,
          latestStatus: cp.active ? 'in_review' : 'closed',
          latestCreatedAt: cp.created_at,
          timestamp: planTime,
          isEnrolledDirect: true,
          isCompleted: !cp.active,
        })
      }
    }

    // Add active and completed direct enrollments
    for (const en of activeEnrollments) {
      if (!en.patient_id) continue
      const existing = summaryMap.get(en.patient_id)
      const enrollTime = new Date(en.enrolled_at || en.created_at).getTime()
      const isComp = en.status === 'completed'

      if (existing) {
        existing.isEnrolledDirect = true
        if (isComp) {
          existing.isCompleted = true
          existing.latestStatus = 'completed'
          existing.activeCount = 0
        }
      } else {
        summaryMap.set(en.patient_id, {
          caseCount: 0,
          activeCount: isComp ? 0 : 1,
          latestSymptoms: en.initial_notes || (isComp ? 'Treatment Completed & Discharged' : 'Post-Encounter Follow-Up'),
          latestStatus: isComp ? 'completed' : 'enrolled',
          latestCreatedAt: en.enrolled_at || en.created_at,
          timestamp: enrollTime,
          isEnrolledDirect: true,
          isCompleted: isComp,
        })
      }
    }

    // Exclude any patients reassigned to another physician
    try {
      const res = await fetch('/api/admin/patient-assignments')
      if (res.ok) {
        const json = await res.json()
        if (json?.assignments) {
          for (const item of json.assignments) {
            if (item.patient_id && item.doctor_id && item.doctor_id !== user.id) {
              summaryMap.delete(item.patient_id)
            }
          }
        }
      }
    } catch {}

    try {
      const { data: otherEnrolls } = await supabase
        .from('enrollments')
        .select('patient_id, doctor_id, status')
        .neq('doctor_id', user.id)
        .eq('status', 'active')

      if (otherEnrolls) {
        for (const o of otherEnrolls) {
          if (o.patient_id) summaryMap.delete(o.patient_id)
        }
      }
    } catch {}

    const patientIds = Array.from(summaryMap.keys())
    let profilesMap: Record<string, string> = {}
    const checkInMap: Record<string, { isOverdue: boolean }> = {}
    const doseMap: Record<string, { adherence: number | null }> = {}

    if (patientIds.length > 0) {
      // 7. Load Profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', patientIds)

      if (!profilesError && profiles) {
        profiles.forEach((p) => {
          profilesMap[p.id] = p.full_name
        })
      }

      // 8. Load check-in status for overdue detection
      try {
        const { data: checkIns } = await supabase
          .from('check_in_logs')
          .select('patient_id, logged_at')
          .in('patient_id', patientIds)
          .order('logged_at', { ascending: false })

        const latestCheckInByPatient = new Map<string, string>()
        if (checkIns) {
          for (const ci of checkIns) {
            if (!latestCheckInByPatient.has(ci.patient_id)) {
              latestCheckInByPatient.set(ci.patient_id, ci.logged_at)
            }
          }
        }

        for (const pId of patientIds) {
          const pSummary = summaryMap.get(pId)
          if (pSummary?.isCompleted) {
            checkInMap[pId] = { isOverdue: false }
            continue
          }

          const plan = doctorCarePlans.find((cp) => cp.patient_id === pId && cp.active)
          if (plan) {
            const latestDate = latestCheckInByPatient.get(pId) || plan.created_at
            const elapsed = Date.now() - new Date(latestDate).getTime()
            // Grace period: > 4 days (default 3 days cadence + 24h grace)
            const isOverdue = elapsed > (4 * 24 * 60 * 60 * 1000)
            checkInMap[pId] = { isOverdue }
          }
        }
      } catch {
        // Fallback
      }

      // 9. Load dose logs summary for adherence
      try {
        const { data: dLogs } = await supabase
          .from('dose_logs')
          .select('patient_id, taken')
          .in('patient_id', patientIds)

        if (dLogs && dLogs.length > 0) {
          const stats = new Map<string, { taken: number; total: number }>()
          for (const dl of dLogs) {
            const cur = stats.get(dl.patient_id) || { taken: 0, total: 0 }
            cur.total += 1
            if (dl.taken) cur.taken += 1
            stats.set(dl.patient_id, cur)
          }

          for (const [pId, cur] of stats.entries()) {
            if (cur.total > 0) {
              doseMap[pId] = { adherence: Math.round((cur.taken / cur.total) * 100) }
            }
          }
        }
      } catch {
        // Fallback
      }
    }

    // 10. Construct real patient cards list
    const realPatients: PatientItem[] = patientIds.map((pId) => {
      const summary = summaryMap.get(pId)!
      const patientName = profilesMap[pId] || 'Patient'
      const initials = getInitials(patientName)

      return {
        id: pId,
        name: patientName,
        initials,
        caseCount: summary.caseCount,
        activeCount: summary.activeCount,
        primaryConcern: summary.latestSymptoms,
        lastInteraction: formatLastInteraction(summary.latestCreatedAt),
        latestStatus: summary.latestStatus,
        timestamp: summary.timestamp,
        isEnrolledDirect: summary.isEnrolledDirect,
        isCheckInOverdue: checkInMap[pId]?.isOverdue,
        adherencePercent: doseMap[pId]?.adherence ?? null,
        isCompleted: summary.isCompleted || false,
      }
    })

    // Sort by most recent interaction descending
    realPatients.sort((a, b) => b.timestamp - a.timestamp)
    setPatients(realPatients)
    setLoading(false)
  }, [router])

  useEffect(() => {
    loadPatients()
  }, [loadPatients])

  // Aggregate cohort metrics
  const totalPatientsCount = patients.length
  const activeCasesCount = useMemo(() => {
    return patients.reduce((sum, p) => sum + p.activeCount, 0)
  }, [patients])

  const activePatientsCount = useMemo(() => {
    return patients.filter((p) => !p.isCompleted && p.activeCount > 0).length
  }, [patients])

  const completedPatientsCount = useMemo(() => {
    return patients.filter((p) => p.isCompleted || p.latestStatus === 'completed').length
  }, [patients])

  const overdueCheckInsCount = useMemo(() => {
    return patients.filter((p) => !p.isCompleted && p.isCheckInOverdue).length
  }, [patients])

  const highRiskPatientsCount = useMemo(() => {
    return patients.filter(
      (p) => !p.isCompleted && typeof p.adherencePercent === 'number' && p.adherencePercent < 75
    ).length
  }, [patients])

  const onTrackPatientsCount = useMemo(() => {
    return patients.filter(
      (p) => !p.isCompleted && typeof p.adherencePercent === 'number' && p.adherencePercent >= 80
    ).length
  }, [patients])

  const cohortAvgAdherence = useMemo(() => {
    const evaluated = patients.filter((p) => !p.isCompleted && typeof p.adherencePercent === 'number')
    if (evaluated.length === 0) return null
    const sum = evaluated.reduce((acc, p) => acc + (p.adherencePercent ?? 0), 0)
    return Math.round(sum / evaluated.length)
  }, [patients])

  // Multi-patient triage filtering and risk sorting
  const displayedPatients = useMemo(() => {
    const q = search.toLowerCase().trim()

    const filtered = patients.filter((p) => {
      const matchesSearch = !q || p.name.toLowerCase().includes(q)
      if (!matchesSearch) return false

      if (filter === 'completed') return !!p.isCompleted || p.latestStatus === 'completed'
      if (filter === 'overdue') return !p.isCompleted && !!p.isCheckInOverdue
      if (filter === 'high_risk') return !p.isCompleted && typeof p.adherencePercent === 'number' && p.adherencePercent < 75
      if (filter === 'on_track') return !p.isCompleted && typeof p.adherencePercent === 'number' && p.adherencePercent >= 80
      if (filter === 'active') return !p.isCompleted && (p.activeCount > 0 || p.latestStatus === 'enrolled' || p.latestStatus === 'in_review')
      return true
    })

    // Sort according to selected criteria
    return filtered.sort((a, b) => {
      if (sortBy === 'risk_first') {
        // 1. Overdue check-ins top priority
        if (a.isCheckInOverdue && !b.isCheckInOverdue) return -1
        if (!a.isCheckInOverdue && b.isCheckInOverdue) return 1

        // 2. Lowest adherence first (0% before 100%)
        const aAdh = a.adherencePercent ?? 999
        const bAdh = b.adherencePercent ?? 999
        if (aAdh !== bAdh) return aAdh - bAdh

        // 3. Recent activity
        return b.timestamp - a.timestamp
      }

      if (sortBy === 'recent') {
        return b.timestamp - a.timestamp
      }

      if (sortBy === 'adherence_asc') {
        const aAdh = a.adherencePercent ?? 999
        const bAdh = b.adherencePercent ?? 999
        return aAdh - bAdh
      }

      if (sortBy === 'adherence_desc') {
        const aAdh = a.adherencePercent ?? -1
        const bAdh = b.adherencePercent ?? -1
        return bAdh - aAdh
      }

      if (sortBy === 'name') {
        return a.name.localeCompare(b.name)
      }

      return 0
    })
  }, [patients, search, filter, sortBy])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-3 border-accent border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-text-muted">Loading enrolled patient roster...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="My Patients" />
      <DoctorDesktopHeader fullName={fullName} />

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex flex-col pb-24 md:pb-12 pt-16 md:pt-0 transition-all duration-300 ease-in-out">
        <div className="flex flex-col w-full max-w-[960px] mx-auto px-4 md:px-8 py-6 md:py-8">
          {/* Header Title & Primary Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl md:text-3xl font-bold text-primary tracking-tight">
                My Patients &amp; Adherence Radar
              </h1>
              <p className="text-sm text-text-muted">
                Track recovery check-ins, medication compliance, and at-risk patients across your cohort.
              </p>
            </div>

            <button
              id="enroll-patient-btn"
              type="button"
              onClick={() => setShowEnrollModal(true)}
              className="py-2.5 px-4 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              <span>+ Enroll Patient</span>
            </button>
          </div>

          {/* Top Cohort Adherence KPI Bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
            {/* Stat Card 1: Total Enrolled */}
            <div className="bg-white border border-border-subtle rounded-xl p-4 shadow-xs flex items-center gap-3.5 transition-all">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">group</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider truncate">
                  Enrolled Cohort
                </span>
                <span className="text-2xl font-bold text-primary mt-0.5">
                  {totalPatientsCount}
                </span>
              </div>
            </div>

            {/* Stat Card 2: Cohort Average Adherence */}
            <div className="bg-white border border-border-subtle rounded-xl p-4 shadow-xs flex items-center gap-3.5 transition-all">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                cohortAvgAdherence === null
                  ? 'bg-surface-secondary text-text-muted'
                  : cohortAvgAdherence >= 80
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                <span className="material-symbols-outlined text-[20px]">monitoring</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider truncate">
                  Avg Adherence
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-2xl font-bold text-primary">
                    {cohortAvgAdherence !== null ? `${cohortAvgAdherence}%` : '—'}
                  </span>
                  <span className="text-[11px] text-text-muted">cohort</span>
                </div>
              </div>
            </div>

            {/* Stat Card 3: Check-In Red Flags */}
            <div
              onClick={() => setFilter(overdueCheckInsCount > 0 ? 'overdue' : 'all')}
              className={`border rounded-xl p-4 shadow-xs flex items-center gap-3.5 transition-all cursor-pointer ${
                overdueCheckInsCount > 0
                  ? 'bg-red-50/70 border-red-200 hover:bg-red-50'
                  : 'bg-white border-border-subtle'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                overdueCheckInsCount > 0 ? 'bg-red-600 text-white' : 'bg-surface-secondary text-text-muted'
              }`}>
                <span className="material-symbols-outlined text-[20px]">notification_important</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider truncate">
                  Check-Ins Overdue
                </span>
                <span className={`text-2xl font-bold mt-0.5 ${overdueCheckInsCount > 0 ? 'text-red-700' : 'text-primary'}`}>
                  {overdueCheckInsCount}
                </span>
              </div>
            </div>

            {/* Stat Card 4: High Risk Adherence (<75%) */}
            <div
              onClick={() => setFilter(highRiskPatientsCount > 0 ? 'high_risk' : 'all')}
              className={`border rounded-xl p-4 shadow-xs flex items-center gap-3.5 transition-all cursor-pointer ${
                highRiskPatientsCount > 0
                  ? 'bg-amber-50/70 border-amber-200 hover:bg-amber-50'
                  : 'bg-white border-border-subtle'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                highRiskPatientsCount > 0 ? 'bg-amber-600 text-white' : 'bg-surface-secondary text-text-muted'
              }`}>
                <span className="material-symbols-outlined text-[20px]">warning</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider truncate">
                  High Risk (&lt;75%)
                </span>
                <span className={`text-2xl font-bold mt-0.5 ${highRiskPatientsCount > 0 ? 'text-amber-700' : 'text-primary'}`}>
                  {highRiskPatientsCount}
                </span>
              </div>
            </div>
          </div>

          {/* Search Bar + Sort Dropdown */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <input
                id="patient-search-input"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patients by name..."
                className="w-full pl-10 pr-10 py-2.5 bg-white rounded-xl text-sm text-primary placeholder:text-text-muted border border-border-subtle focus:outline-none focus:border-accent transition-all shadow-xs"
              />
              {search && (
                <button
                  id="clear-search-btn"
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-text-muted hover:text-primary transition-colors cursor-pointer"
                  title="Clear search"
                >
                  <span className="material-symbols-outlined text-[18px]">cancel</span>
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 bg-white border border-border-subtle rounded-xl px-3 py-2 shadow-xs shrink-0">
              <span className="material-symbols-outlined text-[18px] text-text-muted">sort</span>
              <label htmlFor="patient-sort-select" className="text-xs font-semibold text-text-muted">
                Sort:
              </label>
              <select
                id="patient-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                aria-label="Sort patients"
                className="bg-transparent text-xs font-semibold text-primary focus:outline-none cursor-pointer"
              >
                <option value="risk_first">🚨 Highest Risk First (Recommended)</option>
                <option value="recent">🕒 Recently Active</option>
                <option value="adherence_asc">📉 Adherence: Low to High</option>
                <option value="adherence_desc">📈 Adherence: High to Low</option>
                <option value="name">🔤 Name (A - Z)</option>
              </select>
            </div>
          </div>

          {/* Triage Filter Tabs (Pill Style) */}
          <div
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* All Patients */}
            <button
              id="filter-all-btn"
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
                filter === 'all'
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-white text-text-muted border border-border-subtle hover:border-accent/40 hover:text-primary'
              }`}
            >
              <span>All Patients</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[11px] font-bold ${
                  filter === 'all' ? 'bg-white/20 text-white' : 'bg-surface-secondary text-primary'
                }`}
              >
                {totalPatientsCount}
              </span>
            </button>

            {/* Check-In Overdue */}
            <button
              id="filter-overdue-btn"
              type="button"
              onClick={() => setFilter('overdue')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                filter === 'overdue'
                  ? 'bg-red-600 text-white shadow-xs'
                  : overdueCheckInsCount > 0
                  ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                  : 'bg-white text-text-muted border border-border-subtle hover:text-primary'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${filter === 'overdue' ? 'bg-white' : 'bg-red-600'}`} />
              <span>Overdue Check-Ins</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[11px] font-bold ${
                  filter === 'overdue' ? 'bg-white/20 text-white' : 'bg-red-100 text-red-800'
                }`}
              >
                {overdueCheckInsCount}
              </span>
            </button>

            {/* High Risk (<75%) */}
            <button
              id="filter-high-risk-btn"
              type="button"
              onClick={() => setFilter('high_risk')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                filter === 'high_risk'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : highRiskPatientsCount > 0
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                  : 'bg-white text-text-muted border border-border-subtle hover:text-primary'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${filter === 'high_risk' ? 'bg-white' : 'bg-amber-600'}`} />
              <span>High Risk (&lt;75%)</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[11px] font-bold ${
                  filter === 'high_risk' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {highRiskPatientsCount}
              </span>
            </button>

            {/* On Track (>=80%) */}
            <button
              id="filter-on-track-btn"
              type="button"
              onClick={() => setFilter('on_track')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                filter === 'on_track'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white text-text-muted border border-border-subtle hover:text-primary'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${filter === 'on_track' ? 'bg-white' : 'bg-emerald-600'}`} />
              <span>On Track (≥80%)</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[11px] font-bold ${
                  filter === 'on_track' ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-800'
                }`}
              >
                {onTrackPatientsCount}
              </span>
            </button>

            {/* Active Plans */}
            <button
              id="filter-active-btn"
              type="button"
              onClick={() => setFilter('active')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
                filter === 'active'
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-white text-text-muted border border-border-subtle hover:border-accent/40 hover:text-primary'
              }`}
            >
              <span>Active Plans</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[11px] font-bold ${
                  filter === 'active' ? 'bg-white/20 text-white' : 'bg-accent/10 text-accent'
                }`}
              >
                {activePatientsCount}
              </span>
            </button>

            {/* Completed / Discharged */}
            <button
              id="filter-completed-btn"
              type="button"
              onClick={() => setFilter('completed')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
                filter === 'completed'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'bg-white text-text-muted border border-border-subtle hover:border-emerald-600/40 hover:text-emerald-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${filter === 'completed' ? 'bg-white' : 'bg-emerald-700'}`} />
              <span>📁 Completed ({completedPatientsCount})</span>
            </button>

            {pendingInvitesCount > 0 && (
              <button
                type="button"
                onClick={() => setShowEnrollModal(true)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[15px]">mail</span>
                <span>{pendingInvitesCount} Pending Invites</span>
              </button>
            )}
          </div>

          {/* Patient Cards List */}
          {displayedPatients.length > 0 ? (
            <div className="flex flex-col gap-3" id="patient-cards-container">
              {displayedPatients.map((p) => {
                const statusBadge = getStatusBadge(p.latestStatus)

                return (
                  <div
                    key={p.id}
                    onClick={() => router.push(`/doctor/patients/${p.id}`)}
                    className="patient-card group bg-white rounded-xl p-4 md:p-5 border border-border-subtle hover:border-accent/40 hover:shadow-sm transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    {/* Left: Avatar + Details */}
                    <div className="flex items-start md:items-center gap-3.5 min-w-0">
                      {/* Avatar Circle */}
                      <div className="w-12 h-12 rounded-full bg-accent/10 text-accent font-bold text-base flex items-center justify-center shrink-0 select-none border border-accent/20">
                        {p.initials}
                      </div>

                      {/* Info */}
                      <div className="flex flex-col min-w-0">
                        {/* Name + Status Badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base font-bold text-primary group-hover:text-accent transition-colors">
                            {p.name}
                          </h2>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${statusBadge.className}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${statusBadge.dotColor}`}
                            />
                            {statusBadge.label}
                          </span>

                          {/* 🚨 Check-In Overdue (Main Clinical Red Flag) */}
                          {p.isCheckInOverdue && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 bg-red-100 text-red-800 border border-red-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                              Check-In Overdue
                            </span>
                          )}

                          {/* Calm Dose Adherence Pill */}
                          {p.adherencePercent != null ? (
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 border ${
                                (p.adherencePercent ?? 0) >= 75
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  (p.adherencePercent ?? 0) >= 75 ? 'bg-emerald-600' : 'bg-amber-600'
                                }`}
                              />
                              {p.adherencePercent}% Adherence
                            </span>
                          ) : p.activeCount > 0 ? (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-normal inline-flex items-center gap-1 bg-surface-secondary text-text-muted border border-border-subtle">
                              <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60" />
                              Awaiting Logs
                            </span>
                          ) : null}
                        </div>

                        {/* Case & Care Plan Context */}
                        <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                          <span>
                            {p.isCompleted ? (
                              <span className="text-emerald-800 font-medium">Course Concluded</span>
                            ) : p.caseCount > 0 ? (
                              <>
                                {p.caseCount} {p.caseCount === 1 ? 'case' : 'cases'}
                                {p.activeCount > 0 && (
                                  <span className="text-accent font-semibold ml-1">
                                    ({p.activeCount} active)
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-emerald-700 font-medium">Active Care Plan</span>
                            )}
                          </span>
                          <span>&bull;</span>
                          <span className="truncate max-w-[280px] sm:max-w-md font-normal text-text-muted">
                            {p.primaryConcern}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Last Interaction & View CTA */}
                    <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border-subtle">
                      <div className="text-left md:text-right">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider block">
                          Last Active
                        </span>
                        <span className="text-xs font-medium text-primary">
                          {p.lastInteraction}
                        </span>
                      </div>

                      <div className="w-8 h-8 rounded-lg bg-surface-secondary group-hover:bg-accent group-hover:text-white flex items-center justify-center text-text-muted transition-colors">
                        <span className="material-symbols-outlined text-[18px]">
                          chevron_right
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Empty State */
            <div className="bg-white border border-border-subtle rounded-2xl p-12 text-center flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-surface-secondary text-text-muted flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl">person_search</span>
              </div>
              <h3 className="text-lg font-bold text-primary mb-1">
                {search ? 'No Matching Patients' : 'No Enrolled Patients Yet'}
              </h3>
              <p className="text-sm text-text-muted max-w-sm mb-6">
                {search
                  ? `No patients found matching "${search}". Try clearing the search filter.`
                  : 'Enroll your hospital patients for post-encounter follow-up. Issue a 6-character code to connect with your care plan.'}
              </p>
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="px-4 py-2 bg-surface-secondary hover:bg-surface-secondary/80 text-primary rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Clear Search
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowEnrollModal(true)}
                  className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                  <span>+ Enroll Your First Patient</span>
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      <DoctorBottomNav activePage="My Patients" />

      {/* Doctor Enrollment Modal */}
      <EnrollPatientModal
        isOpen={showEnrollModal}
        onClose={() => setShowEnrollModal(false)}
        doctorId={doctorId}
        doctorName={fullName}
        doctorSpecialty={specialty}
        onEnrollmentCreated={loadPatients}
      />
    </div>
  )
}