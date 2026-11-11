'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import EnrollPatientModal from '@/components/doctor/EnrollPatientModal'
import { evaluateCheckInStatus } from '@/lib/adherence'

type Urgency = 'routine' | 'somewhat_urgent' | 'needs_live_call'

type FollowUpCase = {
  id: string
  symptoms_description: string
  urgency: Urgency
  status: string
  created_at: string
  patient_id: string
  patientName: string
  category: string
  cleanDescription: string
}

type AttentionPatient = {
  patientId: string
  patientName: string
  cadenceLabel: string
  daysOverdue: number
  lastReportStr: string
  planId?: string
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function DoctorDashboardPage() {
  const [doctorId, setDoctorId] = useState('')
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [activeTab, setActiveTab] = useState<'concerns' | 'attention'>('concerns')

  // Metric counts
  const [enrolledCount, setEnrolledCount] = useState(0)
  const [pendingInvitesCount, setPendingInvitesCount] = useState(0)
  const [respondedToday, setRespondedToday] = useState(0)

  // Lists
  const [followUpCases, setFollowUpCases] = useState<FollowUpCase[]>([])
  const [attentionPatients, setAttentionPatients] = useState<AttentionPatient[]>([])

  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    setDoctorId(user.id)

    // 1. Doctor Profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, specialty, role, verified')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'doctor' || !profile.verified) {
      router.push('/login')
      return
    }

    setFullName(profile.full_name || '')
    setSpecialty(profile.specialty || '')

    // 2. Active Enrolled Patients & Pending Invites
    let enrolledPatientIds: string[] = []
    try {
      const { data: activeEnrollments } = await supabase
        .from('enrollments')
        .select('patient_id')
        .eq('doctor_id', user.id)
        .eq('status', 'active')
        .not('patient_id', 'is', null)

      if (activeEnrollments) {
        enrolledPatientIds = activeEnrollments.map((e) => e.patient_id).filter(Boolean)
        setEnrolledCount(enrolledPatientIds.length)
      }

      const { count: pendingCount } = await supabase
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('doctor_id', user.id)
        .eq('status', 'pending')

      setPendingInvitesCount(pendingCount || 0)
    } catch {
      setEnrolledCount(0)
      setPendingInvitesCount(0)
    }

    // 3. Responded Today Count
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    try {
      const { count } = await supabase
        .from('responses')
        .select('id', { count: 'exact', head: true })
        .eq('doctor_id', user.id)
        .gte('created_at', todayStart.toISOString())

      setRespondedToday(count || 0)
    } catch {
      setRespondedToday(0)
    }

    // 4. Load Follow-Up Concerns (Cases assigned to doctor OR from enrolled patients)
    try {
      // Build candidate list: doctor_id = user.id OR patient_id IN enrolledPatientIds
      let casesQuery = supabase
        .from('cases')
        .select('id, symptoms_description, urgency, status, created_at, patient_id, doctor_id')
        .order('created_at', { ascending: false })

      if (enrolledPatientIds.length > 0) {
        casesQuery = casesQuery.or(`doctor_id.eq.${user.id},patient_id.in.(${enrolledPatientIds.join(',')})`)
      } else {
        casesQuery = casesQuery.eq('doctor_id', user.id)
      }

      const { data: rawCases } = await casesQuery

      if (rawCases && rawCases.length > 0) {
        // Collect patient names
        const pIds = [...new Set(rawCases.map((c) => c.patient_id).filter(Boolean))]
        let namesMap = new Map<string, string>()
        if (pIds.length > 0) {
          const { data: pProfiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', pIds)
          if (pProfiles) {
            pProfiles.forEach((p) => namesMap.set(p.id, p.full_name))
          }
        }

        const parsed: FollowUpCase[] = rawCases
          .filter((c) => c.status === 'pending' || c.status === 'in_review')
          .map((c) => {
            const rawDesc = c.symptoms_description || ''
            const match = rawDesc.match(/^\[Category:\s*([^\]]+)\]\s*([\s\S]*)$/i)
            const category = match ? match[1].trim() : 'Follow-Up Concern'
            const cleanDescription = match ? match[2].trim() : rawDesc

            return {
              id: c.id,
              symptoms_description: rawDesc,
              urgency: (c.urgency as Urgency) || 'routine',
              status: c.status,
              created_at: c.created_at,
              patient_id: c.patient_id,
              patientName: namesMap.get(c.patient_id) || 'Enrolled Patient',
              category,
              cleanDescription,
            }
          })

        setFollowUpCases(parsed)
      } else {
        setFollowUpCases([])
      }
    } catch (e) {
      console.error('Error loading cases:', e)
      setFollowUpCases([])
    }

    // 5. Clinical Red Flags: Check-In Status across Enrolled Patients with active care plans
    try {
      const { data: activePlans } = await supabase
        .from('care_plans')
        .select('id, patient_id, schedule, created_at')
        .eq('doctor_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false })

      if (activePlans && activePlans.length > 0) {
        // Deduplicate to latest plan per patient
        const latestPlanByPatient = new Map<string, typeof activePlans[0]>()
        activePlans.forEach((plan) => {
          if (!latestPlanByPatient.has(plan.patient_id)) {
            latestPlanByPatient.set(plan.patient_id, plan)
          }
        })

        const planPatientIds = Array.from(latestPlanByPatient.keys())

        // Fetch patient profiles
        const { data: patientProfiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', planPatientIds)
        const nameMap = new Map(patientProfiles?.map((p) => [p.id, p.full_name]) || [])

        // Fetch latest check-in for each patient
        const { data: recentCheckIns } = await supabase
          .from('check_in_logs')
          .select('patient_id, logged_at')
          .in('patient_id', planPatientIds)
          .order('logged_at', { ascending: false })

        const latestCheckInMap = new Map<string, string>()
        recentCheckIns?.forEach((ci) => {
          if (!latestCheckInMap.has(ci.patient_id)) {
            latestCheckInMap.set(ci.patient_id, ci.logged_at)
          }
        })

        // Evaluate overdue check-ins
        const overdueList: AttentionPatient[] = []
        for (const [patientId, plan] of latestPlanByPatient.entries()) {
          const lastCheckIn = latestCheckInMap.get(patientId) || null
          const status = evaluateCheckInStatus(plan.schedule, lastCheckIn, plan.created_at)

          if (status.isOverdue) {
            overdueList.push({
              patientId,
              patientName: nameMap.get(patientId) || 'Enrolled Patient',
              cadenceLabel: status.cadenceLabel,
              daysOverdue: status.daysOverdue,
              lastReportStr: status.lastReportStr,
              planId: plan.id,
            })
          }
        }

        setAttentionPatients(overdueList)
      } else {
        setAttentionPatients([])
      }
    } catch (e) {
      console.error('Error evaluating red flags:', e)
      setAttentionPatients([])
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    loadData()

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        loadData()
      }
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [loadData])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-text-muted font-medium">Loading clinical command center...</p>
      </div>
    )
  }

  const redFlagCount = attentionPatients.length

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="Dashboard" />
      <DoctorDesktopHeader fullName={fullName} />

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex flex-col pb-24 md:pb-10 pt-16 md:pt-0 transition-all duration-300 ease-in-out">
        <div className="max-w-[1020px] mx-auto w-full px-4 md:px-8 py-6 md:py-8 space-y-6">
          {/* ── Welcome Header ───────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                <span>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                <span>&bull;</span>
                <span className="text-accent font-bold">Attending Physician Portal</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-primary">
                Welcome back, {fullName}
              </h1>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowEnrollModal(true)}
                className="py-2.5 px-4 bg-accent hover:bg-[#0c704d] text-white rounded-xl text-xs font-bold shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                <span>+ Enroll Patient</span>
              </button>
            </div>
          </div>

          {/* ── Post-Encounter KPI Bento Grid ─────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            {/* KPI 1: Enrolled Patients */}
            <Link
              href="/doctor/patients"
              className="bg-white border border-border-subtle hover:border-accent/40 rounded-2xl p-4 md:p-5 flex flex-col justify-between gap-3 transition-all group shadow-xs cursor-pointer"
            >
              <div className="flex items-center justify-between text-text-muted">
                <div className="w-8 h-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">group</span>
                </div>
                <span className="material-symbols-outlined text-[16px] text-text-muted group-hover:text-accent transition-colors">
                  arrow_forward
                </span>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-bold text-primary">{enrolledCount}</p>
                <p className="text-xs font-semibold text-text-muted mt-0.5">Enrolled Patients</p>
                <p className="text-[11px] text-text-muted/80 mt-0.5">Active post-encounter</p>
              </div>
            </Link>

            {/* KPI 2: Follow-Up Notes */}
            <button
              type="button"
              onClick={() => setActiveTab('concerns')}
              className={`bg-white border text-left rounded-2xl p-4 md:p-5 flex flex-col justify-between gap-3 transition-all group shadow-xs cursor-pointer ${
                activeTab === 'concerns' ? 'border-accent ring-1 ring-accent/30' : 'border-border-subtle hover:border-accent/40'
              }`}
            >
              <div className="flex items-center justify-between text-text-muted">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">chat_bubble</span>
                </div>
                {followUpCases.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-[10px]">
                    Action
                  </span>
                )}
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-bold text-primary">{followUpCases.length}</p>
                <p className="text-xs font-semibold text-text-muted mt-0.5">Follow-Up Notes</p>
                <p className="text-[11px] text-text-muted/80 mt-0.5">Unreviewed concerns</p>
              </div>
            </button>

            {/* KPI 3: Clinical Red Flags */}
            <button
              type="button"
              onClick={() => setActiveTab('attention')}
              className={`bg-white border text-left rounded-2xl p-4 md:p-5 flex flex-col justify-between gap-3 transition-all group shadow-xs cursor-pointer ${
                activeTab === 'attention' ? 'border-amber-400 ring-1 ring-amber-300' : 'border-border-subtle hover:border-amber-300'
              }`}
            >
              <div className="flex items-center justify-between text-text-muted">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    redFlagCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-accent'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {redFlagCount > 0 ? 'warning' : 'check_circle'}
                  </span>
                </div>
                {redFlagCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px]">
                    Needs Check
                  </span>
                )}
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-bold text-primary">{redFlagCount}</p>
                <p className="text-xs font-semibold text-text-muted mt-0.5">Clinical Red Flags</p>
                <p className="text-[11px] text-text-muted/80 mt-0.5">
                  {redFlagCount > 0 ? 'Overdue check-ins' : 'All check-ins active'}
                </p>
              </div>
            </button>

            {/* KPI 4: Pending Invites */}
            <div
              onClick={() => setShowEnrollModal(true)}
              className="bg-white border border-border-subtle hover:border-accent/40 rounded-2xl p-4 md:p-5 flex flex-col justify-between gap-3 transition-all group shadow-xs cursor-pointer"
            >
              <div className="flex items-center justify-between text-text-muted">
                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">forward_to_inbox</span>
                </div>
                <span className="material-symbols-outlined text-[16px] text-text-muted group-hover:text-accent transition-colors">
                  arrow_forward
                </span>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-bold text-primary">{pendingInvitesCount}</p>
                <p className="text-xs font-semibold text-text-muted mt-0.5">Pending Invites</p>
                <p className="text-[11px] text-text-muted/80 mt-0.5">Awaiting patient signup</p>
              </div>
            </div>
          </div>

          {/* ── Main Action Required Workspace ───────────────── */}
          <div className="bg-white border border-border-subtle rounded-2xl shadow-xs overflow-hidden">
            {/* Tab Navigation Header */}
            <div className="px-5 py-3.5 bg-surface-secondary/40 border-b border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('concerns')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'concerns'
                      ? 'bg-accent text-white shadow-xs'
                      : 'bg-white border border-border-subtle text-text-muted hover:text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">chat_bubble</span>
                  <span>Patient Follow-Up Notes</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      activeTab === 'concerns' ? 'bg-white/20 text-white' : 'bg-surface-secondary text-text-muted'
                    }`}
                  >
                    {followUpCases.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('attention')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'attention'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-white border border-border-subtle text-text-muted hover:text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  <span>Patients Needing Attention</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      activeTab === 'attention' ? 'bg-white/20 text-white' : 'bg-surface-secondary text-text-muted'
                    }`}
                  >
                    {attentionPatients.length}
                  </span>
                </button>
              </div>

              <div className="text-[11px] text-text-muted flex items-center gap-3">
                <span>Responded Today: <strong className="text-primary">{respondedToday}</strong></span>
              </div>
            </div>

            {/* ── Tab 1: Patient Follow-Up Notes ────────────────── */}
            {activeTab === 'concerns' && (
              <div className="p-5">
                {followUpCases.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-surface-secondary text-text-muted flex items-center justify-center mx-auto mb-3">
                      <span className="material-symbols-outlined text-[24px]">inbox</span>
                    </div>
                    <h3 className="text-sm font-bold text-primary">No Pending Follow-Up Notes</h3>
                    <p className="text-xs text-text-muted max-w-sm mx-auto leading-relaxed">
                      All follow-up questions and symptom notes from your enrolled patients have been addressed.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {followUpCases.map((c) => {
                      const isHigh = c.urgency === 'needs_live_call'
                      const isMed = c.urgency === 'somewhat_urgent'

                      return (
                        <Link
                          key={c.id}
                          href={`/doctor/case/${c.id}`}
                          className="p-4 rounded-xl border border-border-subtle hover:border-accent/60 hover:bg-surface-secondary/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group cursor-pointer"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-primary group-hover:text-accent transition-colors">
                                {c.patientName}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold text-[10px]">
                                {c.category}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                  isHigh
                                    ? 'bg-red-50 text-red-700 border border-red-200'
                                    : isMed
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                    : 'bg-surface-secondary text-text-muted border border-border-subtle'
                                }`}
                              >
                                {c.urgency.replace(/_/g, ' ')}
                              </span>
                            </div>

                            <p className="text-xs text-text-muted line-clamp-1 leading-relaxed">
                              {c.cleanDescription}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                            <span className="text-[11px] text-text-muted font-mono">{timeAgo(c.created_at)}</span>
                            <span className="px-3 py-1.5 rounded-lg bg-surface-secondary group-hover:bg-accent group-hover:text-white text-xs font-bold text-primary transition-colors flex items-center gap-1">
                              <span>Review Note</span>
                              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                            </span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 2: Patients Needing Attention (Clinical Red Flags) ── */}
            {activeTab === 'attention' && (
              <div className="p-5">
                {attentionPatients.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-accent flex items-center justify-center mx-auto mb-3">
                      <span className="material-symbols-outlined text-[24px]">task_alt</span>
                    </div>
                    <h3 className="text-sm font-bold text-primary">All Patients on Track</h3>
                    <p className="text-xs text-text-muted max-w-sm mx-auto leading-relaxed">
                      Zero overdue recovery check-ins across your enrolled patient roster.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {attentionPatients.map((p) => (
                      <div
                        key={p.patientId}
                        className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-primary">{p.patientName}</span>
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold text-[10px] flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">warning</span>
                              Check-In Overdue by {p.daysOverdue} day{p.daysOverdue !== 1 ? 's' : ''}
                            </span>
                            <span className="text-[11px] text-text-muted">
                              Cadence: <strong className="text-primary capitalize">{p.cadenceLabel}</strong>
                            </span>
                          </div>

                          <p className="text-xs text-amber-950/80">
                            Last recovery report: {p.lastReportStr}. Patient has not checked in past the grace window.
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <Link
                            href={`/doctor/patients/${p.patientId}`}
                            className="px-3.5 py-1.5 bg-accent hover:bg-[#0c704d] text-white text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                          >
                            <span>Open Patient Chart</span>
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <DoctorBottomNav activePage="Dashboard" />

      {/* Doctor Enrollment Modal */}
      <EnrollPatientModal
        isOpen={showEnrollModal}
        onClose={() => setShowEnrollModal(false)}
        doctorId={doctorId}
        doctorName={fullName}
        doctorSpecialty={specialty}
        onEnrollmentCreated={loadData}
      />
    </div>
  )
}