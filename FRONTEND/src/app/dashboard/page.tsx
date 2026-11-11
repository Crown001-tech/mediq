'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import BottomNav from '@/components/dashboard/BottomNav'
import TopBar from '@/components/dashboard/TopBar'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'

type CaseItem = {
  id: string
  symptoms_description: string
  urgency: string
  status: string
  created_at: string
  patient_id: string
}

type CarePlan = {
  id: string
  type: string
  details: string
  schedule: string
  doctor_id?: string
}

type PrescribedMed = {
  id: string
  name: string
  dosage: string | null
  schedule_times: string | null
  instructions: string | null
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function timeAgo(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function DashboardPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [cases, setCases] = useState<CaseItem[]>([])
  const [carePlan, setCarePlan] = useState<CarePlan | null>(null)
  const [medications, setMedications] = useState<PrescribedMed[]>([])
  const [doctorName, setDoctorName] = useState('Your Doctor')
  const [doctorSpecialty, setDoctorSpecialty] = useState('General Practice')
  const [isDischarged, setIsDischarged] = useState(false)
  const [dischargeInstructions, setDischargeInstructions] = useState('')
  const [showDischargeToast, setShowDischargeToast] = useState(false)
  const [hospitalAlert, setHospitalAlert] = useState<string | null>(null)
  const [doseReminder, setDoseReminder] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [loading, setLoading] = useState(true)

  const router = useRouter()

  useEffect(() => {
    // Listen for sidebar collapse toggle
    const handleSidebarToggle = (e: Event) => {
      const custom = e as CustomEvent<{ collapsed: boolean }>
      if (custom.detail) {
        setSidebarCollapsed(custom.detail.collapsed)
      }
    }
    window.addEventListener('mediq_sidebar_toggle', handleSidebarToggle)
    const stored = localStorage.getItem('mediq_sidebar_collapsed') === 'true'
    setSidebarCollapsed(stored)

    const loadDashboard = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setEmail(user.email || '')

      // Profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .single()

      if (profile) {
        if (profile.role === 'doctor') {
          router.push('/doctor/dashboard')
          return
        }
        if (profile.role === 'admin') {
          router.push('/admin')
          return
        }
        setFullName(profile.full_name || '')
      }

      // Cases
      const { data: casesData } = await supabase
        .from('cases')
        .select('id, symptoms_description, urgency, status, created_at, patient_id')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(6)

      if (casesData) setCases(casesData)

      // Active Care Plan
      const { data: carePlanData } = await supabase
        .from('care_plans')
        .select('id, type, details, schedule, doctor_id')
        .eq('patient_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (carePlanData) {
        setCarePlan(carePlanData)

        // Prescribed Medications
        const { data: medsData } = await supabase
          .from('medications')
          .select('id, name, dosage, schedule_times, instructions')
          .eq('care_plan_id', carePlanData.id)
          .order('created_at', { ascending: true })

        if (medsData) setMedications(medsData)
      }

      // ── Robust Multi-Source Doctor Resolution & Discharge Detection ──
      let resolvedDoctorId = carePlanData?.doctor_id || null
      let dischargedDetected = false
      let instructionsText = ''

      // Check Enrollment
      try {
        const { data: enrollmentData } = await supabase
          .from('enrollments')
          .select('id, doctor_id, status, initial_notes, updated_at')
          .eq('patient_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (enrollmentData) {
          if (!resolvedDoctorId && enrollmentData.doctor_id) {
            resolvedDoctorId = enrollmentData.doctor_id
          }
          if (enrollmentData.status === 'completed') {
            dischargedDetected = true
            if (enrollmentData.initial_notes) instructionsText = enrollmentData.initial_notes
          }
        }
      } catch {
        // Fallback
      }

      // Check Recent Care Plans (even if inactive/discharged)
      try {
        const { data: latestAnyPlan } = await supabase
          .from('care_plans')
          .select('id, type, details, schedule, active, doctor_id, created_at')
          .eq('patient_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (latestAnyPlan) {
          if (!resolvedDoctorId && latestAnyPlan.doctor_id) {
            resolvedDoctorId = latestAnyPlan.doctor_id
          }
          if (!latestAnyPlan.active && latestAnyPlan.details?.toLowerCase().includes('discharge')) {
            dischargedDetected = true
            if (!instructionsText && latestAnyPlan.details) {
              instructionsText = latestAnyPlan.details
            }
          }
        }
      } catch {
        // Fallback
      }

      // Check Cases as final fallback for assigned doctor
      if (!resolvedDoctorId && casesData && casesData.length > 0) {
        const { data: caseDoc } = await supabase
          .from('cases')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .not('doctor_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (caseDoc?.doctor_id) resolvedDoctorId = caseDoc.doctor_id
      }

      // Check persistent assignment registry
      if (!resolvedDoctorId) {
        try {
          const res = await fetch('/api/admin/patient-assignments')
          if (res.ok) {
            const json = await res.json()
            const match = json?.assignments?.find((a: any) => a.patient_id === user.id)
            if (match?.doctor_id) resolvedDoctorId = match.doctor_id
          }
        } catch { }
      }

      // Check client cache
      if (!resolvedDoctorId) {
        try {
          const stored = localStorage.getItem('mediq_assigned_doctor_id')
          if (stored) resolvedDoctorId = stored
        } catch { }
      }

      // Fetch Profile for Resolved Doctor
      if (resolvedDoctorId) {
        const { data: docProfile } = await supabase
          .from('profiles')
          .select('full_name, specialty')
          .eq('id', resolvedDoctorId)
          .maybeSingle()

        if (docProfile?.full_name) {
          const formatted = formatDoctorName(docProfile.full_name)
          setDoctorName(formatted)
          if (docProfile.specialty) setDoctorSpecialty(docProfile.specialty)
          try {
            localStorage.setItem('mediq_assigned_doctor_id', resolvedDoctorId)
            localStorage.setItem('mediq_assigned_doctor_name', formatted)
          } catch { }
        }
      }

      // Set Discharge state and trigger celebration toast if unacknowledged
      if (dischargedDetected) {
        setIsDischarged(true)
        setDischargeInstructions(instructionsText)
        const toastSeen = localStorage.getItem(`mediq_discharge_toast_seen_${user.id}`)
        if (!toastSeen) {
          setShowDischargeToast(true)
        }
      }

      // Notifications
      const { data: notifs } = await supabase
        .from('notifications')
        .select('type, message, read')
        .eq('user_id', user.id)
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(10)

      if (notifs) {
        const alert = notifs.find((n) => n.type === 'hospital_alert')
        const reminder = notifs.find((n) => n.type === 'dose_reminder')
        if (alert) setHospitalAlert(alert.message)
        if (reminder) setDoseReminder(reminder.message)
      }

      setLoading(false)
    }

    loadDashboard()

    return () => {
      window.removeEventListener('mediq_sidebar_toggle', handleSidebarToggle)
    }
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-text-muted">Loading your dashboard...</p>
      </div>
    )
  }

  const firstName = fullName.trim().split(/\s+/)[0] || 'Patient'
  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="Dashboard" />
      <DesktopHeader fullName={fullName} />
      <TopBar />

      <main
        className={`flex flex-col pb-28 md:pb-12 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'md:ml-20' : 'md:ml-64'
          }`}
      >
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
          {/* ── Welcome Header ───────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border-subtle pb-5">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                <span>{todayFormatted}</span>
                <span>&bull;</span>
                <span className="text-accent flex items-center gap-1 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  Care Connected
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-primary">
                {getGreeting()}, {firstName}
              </h1>
            </div>

            <div className="flex items-center gap-2.5">
              <Link
                href="/submit-case"
                className="px-4 py-2 bg-accent hover:bg-[#0c704d] text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Submit a Case</span>
              </Link>
            </div>
          </div>

          {/* ── Floating Celebratory Discharge Toast ─────────────── */}
          {showDischargeToast && (
            <div className="fixed top-20 right-4 sm:right-8 z-50 max-w-md bg-white border border-emerald-500/40 rounded-2xl p-4 shadow-xl animate-fadeIn">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <span className="material-symbols-outlined text-[20px]">celebration</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                      🎉 Treatment Course Completed!
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDischargeToast(false)
                        localStorage.setItem('mediq_discharge_toast_seen_curr', 'true')
                      }}
                      className="text-text-muted hover:text-primary cursor-pointer"
                      title="Dismiss notification"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                  <p className="text-xs text-primary font-medium mt-1 leading-relaxed">
                    {formatDoctorName(doctorName)} has marked your treatment course as complete and discharged you from active regimen tracking.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Link
                      href="/care-plan"
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-bold transition-all"
                    >
                      View Discharge Summary
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDischargeToast(false)
                        localStorage.setItem('mediq_discharge_toast_seen_curr', 'true')
                      }}
                      className="px-2.5 py-1.5 text-text-muted hover:text-primary text-[11px] font-semibold cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Celebratory Discharge Milestone Banner ───────────── */}
          {isDischarged && (
            <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <span className="material-symbols-outlined text-[22px]">celebration</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-emerald-950">Treatment Course Completed &amp; Discharged</h3>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      Recovery Milestone
                    </span>
                  </div>
                  <p className="text-xs text-emerald-900/85 mt-1 leading-relaxed">
                    Your attending physician, <strong className="text-emerald-950">{formatDoctorName(doctorName)}</strong> ({doctorSpecialty}), has marked your clinical treatment course as complete. Congratulations on completing your recovery plan!
                  </p>
                  {dischargeInstructions && (
                    <p className="text-xs text-emerald-950 font-medium mt-2 italic bg-white/70 p-2.5 rounded-xl border border-emerald-200/60">
                      "{dischargeInstructions.replace(/^\[Discharged\]:\s*/i, '')}"
                    </p>
                  )}
                </div>
              </div>
              <Link
                href="/care-plan"
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs flex items-center gap-1.5 self-start sm:self-center"
              >
                <span>View Care Summary</span>
                <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
              </Link>
            </div>
          )}

          {/* ── Urgent Alert Notice (Realtime from Notifications) ── */}
          {(hospitalAlert || doseReminder) && (
            <div className="space-y-3">
              {hospitalAlert && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[20px]">emergency</span>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-red-800 uppercase tracking-wider">
                        Doctor Notice
                      </h4>
                      <p className="text-xs text-red-900 mt-0.5 font-medium">{hospitalAlert}</p>
                    </div>
                  </div>
                  <Link
                    href="/appointments"
                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors shrink-0 shadow-2xs"
                  >
                    View Appointment
                  </Link>
                </div>
              )}

              {doseReminder && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-accent flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[20px]">medication</span>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                        Medication Reminder
                      </h4>
                      <p className="text-xs text-emerald-950 mt-0.5 font-medium">{doseReminder}</p>
                    </div>
                  </div>
                  <Link
                    href="/log-dose"
                    className="px-3.5 py-1.5 bg-accent hover:bg-[#0c704d] text-white rounded-lg text-xs font-bold transition-colors shrink-0 shadow-2xs"
                  >
                    Log Dose
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* ── 3-Card Executive Quick Action Bento ──────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Action 1: Consult Doctor */}
            <Link
              href="/submit-case"
              className="bg-white border border-border-subtle rounded-2xl p-5 hover:border-accent hover:shadow-xs transition-all flex flex-col justify-between gap-4 group cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0 group-hover:bg-accent group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[20px]">chat_bubble</span>
                </div>
                <span className="text-text-muted group-hover:text-accent transition-colors">
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                  Submit a Case
                </h3>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  Have a symptom, side effect, or health question? Describe it here for your doctor.
                </p>
              </div>
            </Link>

            {/* Action 2: Dose Tracker */}
            <Link
              href="/log-dose"
              className="bg-white border border-border-subtle rounded-2xl p-5 hover:border-accent hover:shadow-xs transition-all flex flex-col justify-between gap-4 group cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-10 h-10 rounded-xl bg-surface-secondary text-primary flex items-center justify-center shrink-0 group-hover:bg-accent group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[20px]">vaccines</span>
                </div>
                <span className="text-text-muted group-hover:text-accent transition-colors">
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                  Log Medication
                </h3>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  Check off the medicines you take today at their scheduled times.
                </p>
              </div>
            </Link>

            {/* Action 3: Doctor Check-In */}
            <Link
              href="/check-in"
              className="bg-white border border-border-subtle rounded-2xl p-5 hover:border-accent hover:shadow-xs transition-all flex flex-col justify-between gap-4 group cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-10 h-10 rounded-xl bg-surface-secondary text-primary flex items-center justify-center shrink-0 group-hover:bg-accent group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[20px]">assignment_turned_in</span>
                </div>
                <span className="text-text-muted group-hover:text-accent transition-colors">
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                  Doctor Check-In
                </h3>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  Routine check-ins set by your doctor to see how your recovery is going.
                </p>
              </div>
            </Link>
          </div>

          {/* ── Main Care & Medication Section (2/3 vs 1/3) ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 8 Cols: Active Care Plan & Medication Schedule */}
            <div className="lg:col-span-8 bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-subtle pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-primary">
                      Your Care Plan &amp; Medications
                    </h2>
                    {carePlan && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                        In Effect
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    Your daily medicines and doctor instructions.
                  </p>
                </div>

                {carePlan && (
                  <Link
                    href="/care-plan"
                    className="text-xs font-bold text-accent hover:underline flex items-center gap-1 self-start sm:self-auto"
                  >
                    <span>View Care Plan</span>
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </Link>
                )}
              </div>

              {!carePlan ? (
                isDischarged ? (
                  /* Discharged & Completed State */
                  <div className="py-8 px-4 text-center space-y-3 bg-emerald-50/40 rounded-xl border border-emerald-200">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                      <span className="material-symbols-outlined text-[26px]">task_alt</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-emerald-950">Care Plan Completed &amp; Discharged</h3>
                      <p className="text-xs text-emerald-900/80 mt-1 max-w-md mx-auto leading-relaxed">
                        Your attending physician, {formatDoctorName(doctorName)} ({doctorSpecialty}), marked this care regimen as complete. You can review your past medications and instructions anytime.
                      </p>
                    </div>
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <Link
                        href="/care-plan"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                      >
                        <span>View Care Summary</span>
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </Link>
                      <Link
                        href="/cases"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-surface-secondary border border-border-subtle rounded-xl text-xs font-bold text-primary transition-colors"
                      >
                        <span>Message Doctor</span>
                        <span className="material-symbols-outlined text-[14px]">chat</span>
                      </Link>
                    </div>
                  </div>
                ) : doctorName !== 'Your Doctor' ? (
                  /* Enrolled with Doctor (Awaiting Care Plan) */
                  <div className="py-8 px-4 text-center space-y-3 bg-surface-secondary/50 rounded-xl border border-border-subtle">
                    <div className="w-12 h-12 rounded-2xl bg-accent/10 text-accent flex items-center justify-center mx-auto">
                      <span className="material-symbols-outlined text-[24px]">stethoscope</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-primary">Enrolled with {formatDoctorName(doctorName)}</h3>
                      <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto leading-relaxed">
                        {doctorSpecialty} • Your physician has enrolled you into clinical follow-up and is preparing your personalized care regimen.
                      </p>
                    </div>
                    <div className="pt-2 flex items-center justify-center gap-2">
                      <Link
                        href="/cases"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                      >
                        <span>Message Your Doctor</span>
                        <span className="material-symbols-outlined text-[14px]">chat</span>
                      </Link>
                    </div>
                  </div>
                ) : (
                  /* General Empty State */
                  <div className="py-10 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-surface-secondary text-text-muted flex items-center justify-center mx-auto">
                      <span className="material-symbols-outlined text-[24px]">assignment</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-primary">No Active Care Plan Yet</h3>
                      <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto leading-relaxed">
                        When your doctor creates your care plan, your medicines, dosages, and instructions will appear here.
                      </p>
                    </div>
                    <div className="pt-1">
                      <Link
                        href="/submit-case"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-surface hover:bg-surface-secondary border border-border-subtle rounded-xl text-xs font-bold text-primary transition-colors"
                      >
                        <span>Describe How You Feel</span>
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </Link>
                    </div>
                  </div>
                )
              ) : (
                /* Active Care Plan Details */
                <div className="space-y-4">
                  {/* Doctor & Cadence Subrow */}
                  <div className="p-3 bg-surface-secondary/60 rounded-xl border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-accent text-[18px]">stethoscope</span>
                      <span className="font-semibold text-primary">
                        Doctor: {doctorName} ({doctorSpecialty})
                      </span>
                    </div>
                    <span className="text-text-muted font-medium capitalize">
                      Schedule: {carePlan.schedule}
                    </span>
                  </div>

                  {/* Medications Matrix Rows */}
                  {medications.length > 0 ? (
                    <div className="border border-border-subtle rounded-xl overflow-hidden divide-y divide-border-subtle">
                      <div className="px-4 py-2.5 bg-surface-secondary/40 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        <span>Your Medications ({medications.length})</span>
                        <span>Dosage &amp; Timing</span>
                      </div>

                      {medications.map((med) => (
                        <div key={med.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-surface-secondary/30 transition-colors">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-primary truncate">
                                {med.name}
                              </span>
                              {med.dosage && (
                                <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-surface-secondary border border-border-subtle text-text-muted">
                                  {med.dosage}
                                </span>
                              )}
                            </div>
                            {med.instructions && (
                              <p className="text-[11px] text-text-muted mt-0.5 truncate">
                                {med.instructions}
                              </p>
                            )}
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-xs font-semibold text-primary block">
                              {med.schedule_times || 'Scheduled Daily'}
                            </span>
                            <Link
                              href="/log-dose"
                              className="text-[11px] font-bold text-accent hover:underline inline-flex items-center gap-0.5 mt-0.5"
                            >
                              Log dose
                              <span className="material-symbols-outlined text-[12px]">check</span>
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-surface-secondary/40 border border-border-subtle rounded-xl text-xs text-primary">
                      <p className="font-semibold">Doctor&apos;s Instructions</p>
                      <p className="text-text-muted mt-1 leading-relaxed">{carePlan.details}</p>
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <Link
                      href="/care-plan"
                      className="text-xs font-bold text-accent hover:underline flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">print</span>
                      Print Care Plan
                    </Link>

                    <Link
                      href="/log-dose"
                      className="px-4 py-2 bg-accent hover:bg-[#0c704d] text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-2xs flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">vaccines</span>
                      <span>Log Today&apos;s Medicine</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Right 4 Cols: Active Cases & Triage Tracker */}
            <div className="lg:col-span-4 bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                <div>
                  <h2 className="text-sm font-bold text-primary">Your Health Cases</h2>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {cases.length} active case{cases.length !== 1 ? 's' : ''} logged
                  </p>
                </div>
                <Link
                  href="/cases"
                  className="text-xs font-bold text-accent hover:underline"
                >
                  View all
                </Link>
              </div>

              {cases.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <span className="material-symbols-outlined text-text-muted text-[24px]">folder_open</span>
                  <p className="text-xs text-text-muted">No open cases yet.</p>
                  <Link
                    href="/submit-case"
                    className="text-xs font-bold text-accent hover:underline inline-block pt-1"
                  >
                    Submit your first case
                  </Link>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {cases.map((c) => {
                    const isUrgent = c.urgency === 'needs_live_call'
                    const isSomewhat = c.urgency === 'somewhat_urgent'

                    return (
                      <Link
                        key={c.id}
                        href={`/cases/${c.id}`}
                        className="p-3 rounded-xl border border-border-subtle hover:border-accent hover:bg-surface-secondary/40 transition-all block group cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${c.status === 'responded'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : c.status === 'in_review'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-surface-secondary text-text-muted border border-border-subtle'
                              }`}
                          >
                            {c.status.replace('_', ' ')}
                          </span>

                          <span className="text-[11px] text-text-muted">
                            {timeAgo(c.created_at)}
                          </span>
                        </div>

                        <h4 className="text-xs font-bold text-primary group-hover:text-accent transition-colors line-clamp-1">
                          {c.symptoms_description}
                        </h4>

                        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-text-muted">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isUrgent ? 'bg-red-500' : isSomewhat ? 'bg-amber-500' : 'bg-gray-400'
                              }`}
                          />
                          <span className="capitalize">{c.urgency.replace(/_/g, ' ')}</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  )
}
