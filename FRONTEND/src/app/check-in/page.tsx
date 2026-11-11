'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'

type CheckInHistoryItem = {
  id: string
  report: string
  logged_at: string
}

const RECOVERY_STAGES = [
  { score: 1, label: 'Significantly Worse', desc: 'Symptoms intensifying' },
  { score: 2, label: 'Somewhat Worse', desc: 'Mild regression' },
  { score: 3, label: 'Unchanged / Stable', desc: 'Symptoms steady' },
  { score: 4, label: 'Noticeably Improved', desc: 'Good recovery progress' },
  { score: 5, label: 'Significantly Resolved', desc: 'Normal baseline reached' },
]

const CLINICAL_OBSERVATIONS = [
  'Pain reduced',
  'Fever resolved',
  'Normal appetite',
  'Restful sleep',
  'Energy returned',
  'Mild fatigue',
  'Digestive upset / Nausea',
  'Lightheadedness',
]

function getCadenceDetails(schedule: string): { label: string; intervalMs: number } {
  const s = (schedule || '').toLowerCase()
  if (s.includes('3 days') || s.includes('3_days')) {
    return { label: 'Every 3 Days', intervalMs: 3 * 24 * 60 * 60 * 1000 }
  }
  if (s.includes('weekly')) {
    return { label: 'Weekly', intervalMs: 7 * 24 * 60 * 60 * 1000 }
  }
  if (s.includes('monthly')) {
    return { label: 'Monthly', intervalMs: 30 * 24 * 60 * 60 * 1000 }
  }
  return { label: 'Daily', intervalMs: 24 * 60 * 60 * 1000 }
}

function formatRelativeTime(targetMs: number): string {
  const diffMs = targetMs - Date.now()
  if (diffMs <= 0) return 'Due now'
  const hours = Math.ceil(diffMs / (1000 * 60 * 60))
  if (hours < 24) return `in ${hours} hour${hours > 1 ? 's' : ''}`
  const days = Math.ceil(hours / 24)
  return `in ${days} day${days > 1 ? 's' : ''}`
}

export default function CheckInPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [carePlanId, setCarePlanId] = useState<string | null>(null)
  const [carePlanType, setCarePlanType] = useState('Treatment Protocol')
  const [carePlanSchedule, setCarePlanSchedule] = useState('daily')
  const [doctorName, setDoctorName] = useState('Your Doctor')
  const [doctorSpecialty, setDoctorSpecialty] = useState('Internal Medicine')
  const [history, setHistory] = useState<CheckInHistoryItem[]>([])
  const [planCreatedAt, setPlanCreatedAt] = useState<string | null>(null)

  // Form State
  const [rating, setRating] = useState<number>(4)
  const [selectedObs, setSelectedObs] = useState<string[]>([])
  const [reportNotes, setReportNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState(false)

  const router = useRouter()

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setEmail(user.email || '')

      // 1. Profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      if (profile) setFullName(profile.full_name)

      // 2. Active Care Plan
      const { data: plan } = await supabase
        .from('care_plans')
        .select('id, type, details, schedule, doctor_id, created_at')
        .eq('patient_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (plan) {
        setCarePlanId(plan.id)
        setPlanCreatedAt(plan.created_at || null)
        setCarePlanType(plan.type || 'Treatment Protocol')
        setCarePlanSchedule(plan.schedule || 'daily')

        if (plan.doctor_id) {
          const { data: doc } = await supabase
            .from('profiles')
            .select('full_name, specialty')
            .eq('id', plan.doctor_id)
            .maybeSingle()
          if (doc?.full_name) setDoctorName(formatDoctorName(doc.full_name))
          if (doc?.specialty) setDoctorSpecialty(doc.specialty)
        }

        // Fetch Recent Check-Ins
        const { data: logs } = await supabase
          .from('check_in_logs')
          .select('id, report, logged_at')
          .eq('care_plans_id', plan.id)
          .order('logged_at', { ascending: false })
          .limit(3)

        if (logs) setHistory(logs)
      }

      setLoading(false)
    }

    loadData()
  }, [router])

  // Doctor-Controlled Schedule Timing Logic
  const cadenceInfo = useMemo(() => getCadenceDetails(carePlanSchedule), [carePlanSchedule])

  const checkInScheduleStatus = useMemo(() => {
    // Base timestamp: if patient has already submitted a check-in, calculate from the last check-in.
    // If NO check-ins have been submitted yet, calculate strictly from the day the care plan was assigned!
    const baseTimeMs = history.length > 0
      ? new Date(history[0].logged_at).getTime()
      : planCreatedAt
        ? new Date(planCreatedAt).getTime()
        : Date.now()

    const nextDueMs = baseTimeMs + cadenceInfo.intervalMs
    const isDue = Date.now() >= nextDueMs

    const nextDueDateObj = new Date(nextDueMs)
    const nextDueDateStr = nextDueDateObj.toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }) + ` at ${nextDueDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`

    return { isDue, nextDueMs, nextDueDateStr }
  }, [history, cadenceInfo, planCreatedAt])

  const toggleObservation = (obs: string) => {
    setSelectedObs((prev) =>
      prev.includes(obs) ? prev.filter((o) => o !== obs) : [...prev, obs]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!carePlanId) {
      setError('No active care plan found.')
      return
    }

    setSubmitting(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const obsText = selectedObs.length > 0 ? ` [Observed: ${selectedObs.join(', ')}]` : ''
    const scheduleTag = `[Cadence: ${cadenceInfo.label}]`
    const finalReport = `[Status: ${rating}/5 - ${RECOVERY_STAGES.find((s) => s.score === rating)?.label}] ${scheduleTag}${obsText} ${reportNotes.trim() || 'Patient reported steady progress.'}`.trim()

    const { error: insertError } = await supabase.from('check_in_logs').insert({
      care_plans_id: carePlanId,
      patient_id: user.id,
      report: finalReport,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setSuccess(true)
    setTimeout(() => {
      router.push('/care-plan')
    }, 1000)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-text-muted">Loading your check-in schedule...</p>
      </div>
    )
  }

  const isFormActive = checkInScheduleStatus.isDue

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="Care Plan" />
      <TopBar />
      <DesktopHeader />

      <main className="md:ml-64 flex flex-col pb-28 md:pb-12">
        <div className="max-w-xl mx-auto w-full px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* ── Breadcrumb & Header ─────────────────────────── */}
          <div className="space-y-3">
            <Link
              href="/care-plan"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Care Plan
            </Link>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 border-b border-border-subtle pb-4">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-primary">
                  Doctor Check-In
                </h1>
                <p className="text-xs text-text-muted mt-0.5">
                  Scheduled recovery follow-up for {formatDoctorName(doctorName)}.
                </p>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1 sm:mt-0">
                <span className="material-symbols-outlined text-[14px]">stethoscope</span>
                <span>{formatDoctorName(doctorName)} ({doctorSpecialty})</span>
              </div>
            </div>
          </div>

          {!carePlanId ? (
            /* Empty State */
            <div className="bg-surface border border-border-subtle rounded-xl p-8 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-surface-secondary text-text-muted flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-[20px]">assignment</span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">No Active Care Plan</h3>
                <p className="text-xs text-text-muted mt-1 max-w-xs mx-auto">
                  A check-in can only be submitted once an active treatment regimen has been initiated by your doctor.
                </p>
              </div>
              <Link
                href="/cases"
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline pt-1"
              >
                Initiate a consultation
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </Link>
            </div>
          ) : success ? (
            /* Success Feedback */
            <div className="bg-surface border border-accent/30 rounded-xl p-8 text-center space-y-3 animate-in fade-in duration-200">
              <div className="w-10 h-10 rounded-full bg-accent/10 text-accent flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-[22px]">check</span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">Check-In Sent</h3>
                <p className="text-xs text-text-muted mt-1">
                  Your progress report has been submitted to {formatDoctorName(doctorName)}.
                </p>
              </div>
              <div className="text-[11px] text-accent font-medium flex items-center justify-center gap-1 pt-1">
                <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Returning to Care Plan...
              </div>
            </div>
          ) : !isFormActive ? (
            /* ── Doctor Scheduled: Locked Card ─────── */
            <div className="bg-surface border border-border-subtle rounded-xl p-6 md:p-7 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[22px]">lock_clock</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-primary">Check-In Scheduled by Doctor</h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      Schedule cadence: <strong className="text-primary font-semibold">{cadenceInfo.label}</strong>
                    </p>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-secondary border border-border-subtle text-[11px] font-semibold text-accent">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                  Scheduled
                </span>
              </div>

              {/* Next Review Schedule Box */}
              <div className="p-4 rounded-lg bg-surface-secondary border border-border-subtle text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted font-medium">Next Scheduled Check-In</span>
                  <span className="font-semibold text-accent">
                    {formatRelativeTime(checkInScheduleStatus.nextDueMs)}
                  </span>
                </div>
                <p className="text-primary font-bold text-sm">
                  {checkInScheduleStatus.nextDueDateStr}
                </p>
                <p className="text-[11px] text-text-muted pt-1 leading-relaxed">
                  Your doctor set your check-in schedule to {cadenceInfo.label} to evaluate your progress at the proper time. You will be able to complete this check-in once your scheduled date arrives.
                </p>
              </div>

              {/* Last Submission Preview */}
              {history.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted block">
                    Last Completed Check-In
                  </span>
                  <div className="p-3 rounded-lg border border-border-subtle bg-white text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-text-muted">
                      <span>
                        {new Date(history[0].logged_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })} at {new Date(history[0].logged_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-accent font-medium">Sent to Doctor</span>
                    </div>
                    <p className="text-text-muted line-clamp-2">
                      {history[0].report}
                    </p>
                  </div>
                </div>
              )}

              {/* Submit a Case prompt for immediate symptoms */}
              <div className="pt-4 border-t border-border-subtle bg-accent/5 -mx-6 -mb-6 md:-mx-7 md:-mb-7 p-5 rounded-b-xl border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-accent text-[18px]">medical_services</span>
                    Feeling unwell or have a new symptom right now?
                  </h4>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    Check-ins are for scheduled follow-ups. If you are experiencing a symptom or concern before your check-in date, submit a case instead.
                  </p>
                </div>
                <Link
                  href="/submit-case"
                  className="px-4 py-2 bg-accent hover:bg-[#0c704d] text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1.5 shadow-2xs self-start sm:self-auto"
                >
                  <span className="material-symbols-outlined text-[16px]">add_circle</span>
                  Submit a Case
                </Link>
              </div>
            </div>
          ) : (
            /* ── Active Form (Due Now) ────────────── */
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Scheduled Status Banner */}
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-700 text-[20px]">check_circle</span>
                  <span>
                    <strong>{cadenceInfo.label} Check-In Due Now</strong> &bull; Scheduled by {formatDoctorName(doctorName)}
                  </span>
                </div>
              </div>

              {/* ── 1. Recovery Scale (Clinical Segmented Bar) ─── */}
              <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    1. Overall Condition Progression
                  </span>
                  <span className="text-[11px] font-medium text-accent">
                    {RECOVERY_STAGES.find((s) => s.score === rating)?.label}
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-1.5 p-1 bg-surface-secondary rounded-lg border border-border-subtle">
                  {RECOVERY_STAGES.map((stage) => {
                    const active = rating === stage.score
                    return (
                      <button
                        key={stage.score}
                        type="button"
                        onClick={() => setRating(stage.score)}
                        className={`py-2 px-1 rounded-md text-xs font-medium transition-all text-center cursor-pointer ${active
                            ? 'bg-white text-primary font-semibold shadow-xs'
                            : 'text-text-muted hover:text-primary'
                          }`}
                      >
                        <span className="block font-semibold text-sm">{stage.score}</span>
                        <span className="text-[9px] block truncate opacity-70">
                          {stage.score <= 2 ? 'Worse' : stage.score === 3 ? 'Stable' : 'Better'}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="text-[11px] text-text-muted text-center pt-0.5">
                  {RECOVERY_STAGES.find((s) => s.score === rating)?.desc}
                </p>
              </div>

              {/* ── 2. Clinical Observations (Neutral Chips) ──── */}
              <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    2. Specific Symptoms & Observations
                  </span>
                  <span className="text-[11px] text-text-muted">Select all that apply</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {CLINICAL_OBSERVATIONS.map((obs) => {
                    const selected = selectedObs.includes(obs)
                    return (
                      <button
                        key={obs}
                        type="button"
                        onClick={() => toggleObservation(obs)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${selected
                            ? 'bg-primary text-white border-primary'
                            : 'bg-surface text-primary border-border-subtle hover:bg-surface-secondary'
                          }`}
                      >
                        {obs}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ── 3. Notes for Attending Physician ─────────── */}
              <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="report" className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    3. Detailed Clinical Remarks
                  </label>
                  <span className="text-[11px] text-text-muted">Optional</span>
                </div>
                <textarea
                  id="report"
                  rows={3}
                  value={reportNotes}
                  onChange={(e) => setReportNotes(e.target.value)}
                  placeholder="Describe changes in symptoms, side effects, or questions for your attending physician"
                  className="w-full p-2.5 bg-surface-secondary/40 border border-border-subtle rounded-lg text-xs font-medium text-primary focus:border-accent transition-all resize-none"
                />
              </div>

              {/* Emergency Notice */}
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-900 flex items-start gap-2">
                <span className="material-symbols-outlined text-[16px] text-red-600 shrink-0 mt-0.5">
                  warning
                </span>
                <p className="leading-relaxed">
                  Doctor check-ins are not for emergencies. If you have severe chest pain, shortness of breath, or urgent symptoms, please go to the nearest emergency room immediately.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}

              {/* ── Submit Action ──────────────────────────────── */}
              <div className="pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  {submitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Sending Check-In...</span>
                    </>
                  ) : (
                    <span>Send Check-In to Doctor</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  )
}