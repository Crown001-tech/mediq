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
import { parseMedicationDuration, autoReconcileMissedDoses } from '@/lib/adherence'

type Medication = {
  id: string
  name: string
  dosage: string | null
  schedule_times: string | null
  instructions: string | null
}

type DoseLogRecord = {
  id: string
  taken: boolean
  feeling_tag: string | null
  notes: string | null
  logged_at: string
}

type DoseSlot = {
  slotKey: string
  medId: string
  medName: string
  dosage: string | null
  instructions: string | null
  timeStr: string
  isTimeReached: boolean
  isLockedEarly: boolean
  isWindowExpired: boolean
  isWindowActive: boolean
  earlyAvailableTimeStr?: string
  expiredCutoffTimeStr?: string
  isLoggedToday: boolean
  loggedAtStr?: string
  isCourseEnded: boolean
  progressText: string
}

function parseTimeToToday(timeStr: string): Date | null {
  if (!timeStr || timeStr.toLowerCase().includes('prn') || timeStr.toLowerCase().includes('needed')) {
    return null
  }
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return null

  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const ampm = match[3]?.toUpperCase()

  if (ampm === 'PM' && hours < 12) hours += 12
  if (ampm === 'AM' && hours === 12) hours = 0

  const d = new Date()
  d.setHours(hours, minutes, 0, 0)
  return d
}

export default function LogDosePage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [carePlanId, setCarePlanId] = useState<string | null>(null)
  const [doctorName, setDoctorName] = useState('Your Doctor')
  const [medications, setMedications] = useState<Medication[]>([])
  const [planSummary, setPlanSummary] = useState('')
  const [planCreatedAt, setPlanCreatedAt] = useState<string | null>(null)
  const [recentLogs, setRecentLogs] = useState<DoseLogRecord[]>([])
  const [todayLogs, setTodayLogs] = useState<DoseLogRecord[]>([])

  // Interaction State
  const [loggingSlotKey, setLoggingSlotKey] = useState<string | null>(null)
  const [activeNoteSlotKey, setActiveNoteSlotKey] = useState<string | null>(null)
  const [slotNote, setSlotNote] = useState('')
  const [showCelebrationToast, setShowCelebrationToast] = useState(false)
  const [toastMedCompletedName, setToastMedCompletedName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [currentEpoch, setCurrentEpoch] = useState<number>(Date.now())

  const router = useRouter()

  // Auto-refresh clock every 30 seconds to update time-gated slots
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentEpoch(Date.now())
    }, 30000)
    return () => clearInterval(timer)
  }, [])

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
      .select('id, details, schedule, type, doctor_id, created_at')
      .eq('patient_id', user.id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (plan) {
      setCarePlanId(plan.id)
      setPlanCreatedAt(plan.created_at || null)
      setPlanSummary(plan.details || plan.schedule || 'Active Care Plan')

      // Fetch Doctor Name
      if (plan.doctor_id) {
        const { data: doc } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', plan.doctor_id)
          .maybeSingle()
        if (doc?.full_name) setDoctorName(formatDoctorName(doc.full_name))
      }

      // Fetch Prescribed Medications
      const { data: meds } = await supabase
        .from('medications')
        .select('id, name, dosage, schedule_times, instructions')
        .eq('care_plan_id', plan.id)
        .order('created_at', { ascending: true })

      if (meds && meds.length > 0) {
        setMedications(meds)
        // Silent background auto-miss reconciliation (2-hour window)
        await autoReconcileMissedDoses(supabase, plan.id, user.id, meds, plan.created_at)
      }

      // Fetch Dose Logs for this plan
      const { data: logs } = await supabase
        .from('dose_logs')
        .select('id, taken, feeling_tag, notes, logged_at')
        .eq('care_plans_id', plan.id)
        .order('logged_at', { ascending: false })
        .limit(30)

      if (logs) {
        setRecentLogs(logs)

        // Filter logs recorded today (since local 00:00:00)
        const startOfToday = new Date()
        startOfToday.setHours(0, 0, 0, 0)
        const todayItems = logs.filter(
          (l) => new Date(l.logged_at).getTime() >= startOfToday.getTime()
        )
        setTodayLogs(todayItems)
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [router])

  // Build granular dose slots for each medication scheduled today with strict 15m early lock & 2h missed window
  const doseSlots = useMemo<DoseSlot[]>(() => {
    if (!medications || medications.length === 0) return []

    const slots: DoseSlot[] = []
    const now = currentEpoch

    medications.forEach((med) => {
      const duration = parseMedicationDuration(med.instructions, planCreatedAt)
      const isCourseEnded = duration.isCompleted

      // Extract scheduled times, e.g. "08:00 AM, 08:00 PM"
      let times = ['08:00 AM']
      if (med.schedule_times && med.schedule_times.trim()) {
        times = med.schedule_times.split(',').map((t) => t.trim()).filter(Boolean)
      }

      times.forEach((timeStr) => {
        const slotKey = `${med.id}_${timeStr.replace(/[^a-zA-Z0-9]/g, '')}`
        const targetDate = parseTimeToToday(timeStr)

        let isLockedEarly = false
        let isWindowExpired = false
        let isWindowActive = true
        let earlyAvailableTimeStr = ''
        let expiredCutoffTimeStr = ''

        if (targetDate) {
          const scheduledMs = targetDate.getTime()
          const earliestAllowedMs = scheduledMs - 15 * 60 * 1000 // 15 mins prior
          const latestAllowedMs = scheduledMs + 2 * 60 * 60 * 1000 // 2 hours after

          isLockedEarly = now < earliestAllowedMs
          isWindowExpired = now > latestAllowedMs
          isWindowActive = now >= earliestAllowedMs && now <= latestAllowedMs

          earlyAvailableTimeStr = new Date(earliestAllowedMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          expiredCutoffTimeStr = new Date(latestAllowedMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }

        const isTimeReached = !isLockedEarly

        // Check if this specific medication and time slot has been logged today
        const matchingLog = todayLogs.find((l) => {
          if (!l.taken) return false
          const notesText = l.notes || ''
          const matchesMed = notesText.includes(med.id) || l.feeling_tag === med.name || notesText.includes(med.name)
          const matchesTime = !targetDate || notesText.includes(timeStr)
          return matchesMed && matchesTime
        })

        const isLoggedToday = !!matchingLog
        const loggedAtStr = matchingLog
          ? new Date(matchingLog.logged_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
          : undefined

        slots.push({
          slotKey,
          medId: med.id,
          medName: med.name,
          dosage: med.dosage,
          instructions: med.instructions,
          timeStr,
          isTimeReached,
          isLockedEarly,
          isWindowExpired,
          isWindowActive,
          earlyAvailableTimeStr,
          expiredCutoffTimeStr,
          isLoggedToday,
          loggedAtStr,
          isCourseEnded,
          progressText: duration.progressText,
        })
      })
    })

    return slots
  }, [medications, planCreatedAt, todayLogs, currentEpoch])

  // Overall today completion count
  const activeSlots = doseSlots.filter((s) => !s.isCourseEnded)
  const completedSlots = activeSlots.filter((s) => s.isLoggedToday)
  const allCompletedToday = activeSlots.length > 0 && completedSlots.length === activeSlots.length

  // Handle logging a single medication dose
  const handleLogSingleDose = async (slot: DoseSlot) => {
    if (!carePlanId) return
    setError('')

    if (slot.isLockedEarly) {
      setError(`Cannot log dose yet. Logging opens 15 minutes before scheduled time (at ${slot.earlyAvailableTimeStr || slot.timeStr}).`)
      return
    }
    if (slot.isWindowExpired) {
      setError(`The 2-hour logging window for this dose closed at ${slot.expiredCutoffTimeStr}. It has been marked as Missed.`)
      return
    }

    setLoggingSlotKey(slot.slotKey)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const timeNow = new Date()
    const timeFormatted = timeNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    const noteContent = slotNote.trim() ? ` - Note: ${slotNote.trim()}` : ''
    const logSummary = `[MedId:${slot.medId}] [Time:${slot.timeStr}] Taken at ${timeFormatted}${noteContent}`

    const { data: newLog, error: insertError } = await supabase
      .from('dose_logs')
      .insert({
        care_plans_id: carePlanId,
        patient_id: user.id,
        taken: true,
        feeling_tag: slot.medName,
        notes: logSummary,
        logged_at: timeNow.toISOString(),
      })
      .select('id, taken, feeling_tag, notes, logged_at')
      .single()

    setLoggingSlotKey(null)
    setActiveNoteSlotKey(null)
    setSlotNote('')

    if (insertError || !newLog) {
      setError(insertError?.message || 'Failed to log dose. Please try again.')
      return
    }

    // Update local logs state immediately
    const updatedToday = [newLog, ...todayLogs]
    setTodayLogs(updatedToday)
    setRecentLogs((prev) => [newLog, ...prev])

    // Check if ALL active dose slots for today are now completed
    const remainingUnlogged = activeSlots.filter(
      (s) => s.slotKey !== slot.slotKey && !s.isLoggedToday
    )

    if (remainingUnlogged.length === 0) {
      // Trigger celebratory toaster!
      setShowCelebrationToast(true)
    } else {
      setToastMedCompletedName(slot.medName)
      setTimeout(() => setToastMedCompletedName(null), 4000)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-text-muted">Loading your medicines...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="Care Plan" />
      <TopBar />
      <DesktopHeader />

      {/* ── All Completed Celebratory Toaster ─────────────────── */}
      {showCelebrationToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] bg-[#0B543B] text-white p-4 sm:p-5 rounded-2xl shadow-2xl border-2 border-[#15805D] flex items-start justify-between gap-3 animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0 text-amber-300 text-2xl select-none">
              🎉
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">
                All Medications Completed!
              </h3>
              <p className="text-xs text-emerald-100 mt-1 leading-relaxed">
                You have completed your medications for today, make sure to rest well.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCelebrationToast(false)}
            className="text-emerald-200 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            aria-label="Close notification"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
      )}

      {/* ── Single Dose Logged Toast ─────────────────────────── */}
      {toastMedCompletedName && !showCelebrationToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%] bg-white text-primary p-3.5 rounded-xl shadow-lg border border-border-subtle flex items-center justify-between gap-3 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-accent text-[22px]">check_circle</span>
            <p className="text-xs font-semibold text-primary">
              Logged <strong className="text-accent">{toastMedCompletedName}</strong> as taken.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setToastMedCompletedName(null)}
            className="text-text-muted hover:text-primary"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      <main className="md:ml-64 flex flex-col pb-28 md:pb-12 pt-16 md:pt-0">
        <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* ── Breadcrumb & Header ─────────────────────────── */}
          <div className="space-y-3">
            <Link
              href="/care-plan"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Care Plan
            </Link>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-border-subtle pb-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-primary">
                  Log Medication
                </h1>
                <p className="text-xs text-text-muted mt-0.5">
                  Record each medicine as you take it. Scheduled by {doctorName}.
                </p>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
                <span className="material-symbols-outlined text-accent text-[16px]">stethoscope</span>
                <span>{doctorName}</span>
              </div>
            </div>
          </div>

          {!carePlanId || medications.length === 0 ? (
            /* ── Empty State ── */
            <div className="bg-white border border-border-subtle rounded-2xl p-10 text-center space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-surface-secondary text-text-muted flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-[24px]">medication</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-primary">No Prescribed Medications</h3>
                <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto leading-relaxed">
                  Your doctor has not added any medications to your care plan yet.
                </p>
              </div>
              <div className="pt-2">
                <Link
                  href="/submit-case"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-[#0c704d] transition-colors shadow-2xs"
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  <span>Contact Doctor</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* ── Today's Progress Card ─────────────────────── */}
              <div className="bg-white border border-border-subtle rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted block">
                      Today&apos;s Medications
                    </span>
                    <h2 className="text-sm sm:text-base font-bold text-primary mt-0.5">
                      {completedSlots.length} of {activeSlots.length} doses taken today
                    </h2>
                  </div>

                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 ${allCompletedToday
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-surface-secondary text-text-muted'
                      }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${allCompletedToday ? 'bg-emerald-600' : 'bg-amber-500'
                        }`}
                    />
                    {allCompletedToday ? 'Completed' : 'In Progress'}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${allCompletedToday ? 'bg-emerald-600' : 'bg-accent'
                      }`}
                    style={{
                      width: `${activeSlots.length > 0 ? (completedSlots.length / activeSlots.length) * 100 : 0}%`,
                    }}
                  />
                </div>

                {allCompletedToday && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs text-emerald-900 mt-2">
                    <span className="material-symbols-outlined text-emerald-600 text-[20px]">
                      task_alt
                    </span>
                    <p className="font-semibold">
                      You have completed your medications for today! Make sure to rest well.
                    </p>
                  </div>
                )}
              </div>

              {/* ── Per-Medication Dose Action Cards ──────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Prescribed Medicines ({doseSlots.length})
                  </h3>
                  <span className="text-[11px] text-text-muted">
                    Doses are logged one-by-one at scheduled times
                  </span>
                </div>

                {doseSlots.map((slot) => {
                  const isProcessing = loggingSlotKey === slot.slotKey
                  const isNoteOpen = activeNoteSlotKey === slot.slotKey

                  return (
                    <div
                      key={slot.slotKey}
                      className={`bg-white border rounded-2xl p-4 sm:p-5 transition-all shadow-xs ${slot.isLoggedToday
                          ? 'border-emerald-200 bg-emerald-50/20'
                          : !slot.isTimeReached
                            ? 'border-border-subtle bg-[#FAFAFA]'
                            : 'border-accent/40 ring-1 ring-accent/20'
                        }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {/* Medicine Details */}
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4
                              className={`text-sm font-bold ${slot.isLoggedToday
                                  ? 'text-emerald-950'
                                  : slot.isCourseEnded
                                    ? 'text-text-muted line-through'
                                    : 'text-primary'
                                }`}
                            >
                              {slot.medName}
                            </h4>

                            {slot.dosage && (
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-surface-secondary text-primary font-semibold border border-border-subtle">
                                {slot.dosage}
                              </span>
                            )}

                            <span className="text-xs font-bold text-accent px-2 py-0.5 rounded bg-accent/10 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">schedule</span>
                              {slot.timeStr}
                            </span>
                          </div>

                          {slot.instructions && (
                            <p className="text-xs text-text-muted leading-relaxed">
                              {slot.instructions}
                            </p>
                          )}

                          {slot.isCourseEnded && (
                            <span className="inline-block text-[10px] font-bold text-text-muted uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100">
                              Course Ended ({slot.progressText})
                            </span>
                          )}
                        </div>

                        {/* Status / Action Button */}
                        <div className="shrink-0 flex items-center gap-2 self-start sm:self-center">
                          {slot.isLoggedToday ? (
                            /* Already Logged Today */
                            <div className="flex items-center gap-2 bg-emerald-100/80 border border-emerald-200 text-emerald-900 px-3.5 py-2 rounded-xl text-xs font-bold">
                              <span className="material-symbols-outlined text-[18px] text-emerald-700">
                                check_circle
                              </span>
                              <span>
                                Taken {slot.loggedAtStr ? `at ${slot.loggedAtStr}` : 'Today'}
                              </span>
                            </div>
                          ) : slot.isCourseEnded ? (
                            <span className="text-xs text-text-muted italic px-2">Course ended</span>
                          ) : slot.isLockedEarly ? (
                            /* Locked Early: More than 15 minutes before scheduled dose */
                            <div
                              className="bg-gray-100 border border-gray-200 text-gray-500 px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-not-allowed"
                              title={`Scheduled for ${slot.timeStr}. Logging opens 15 minutes prior at ${slot.earlyAvailableTimeStr || slot.timeStr}.`}
                            >
                              <span className="material-symbols-outlined text-[16px] text-gray-400">lock_clock</span>
                              <span>Opens at {slot.earlyAvailableTimeStr || slot.timeStr} (15m prior)</span>
                            </div>
                          ) : slot.isWindowExpired ? (
                            /* Window Expired: More than 2 hours after scheduled dose */
                            <div
                              className="bg-amber-50 border border-amber-200 text-amber-900 px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                              title={`The 2-hour window to log this dose closed at ${slot.expiredCutoffTimeStr}. Marked as Untaken / Missed.`}
                            >
                              <span className="material-symbols-outlined text-[16px] text-amber-600">event_busy</span>
                              <span>Missed (2h window expired at {slot.expiredCutoffTimeStr})</span>
                            </div>
                          ) : (
                            /* Window Active: between -15m and +2h */
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveNoteSlotKey(isNoteOpen ? null : slot.slotKey)
                                }
                                className="w-9 h-9 rounded-xl border border-border-subtle hover:bg-surface-secondary text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
                                title="Add a quick note"
                              >
                                <span className="material-symbols-outlined text-[18px]">edit_note</span>
                              </button>

                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => handleLogSingleDose(slot)}
                                className="bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                              >
                                {isProcessing ? (
                                  <>
                                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    <span>Saving...</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="material-symbols-outlined text-[16px]">check</span>
                                    <span>Take &amp; Log Dose</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Optional Note Box for this Slot */}
                      {isNoteOpen && !slot.isLoggedToday && (
                        <div className="mt-3 pt-3 border-t border-border-subtle space-y-2 animate-in fade-in duration-150">
                          <label
                            htmlFor={`note-${slot.slotKey}`}
                            className="text-[11px] font-semibold text-text-muted block"
                          >
                            Add a note for this dose (optional):
                          </label>
                          <div className="flex gap-2">
                            <input
                              id={`note-${slot.slotKey}`}
                              type="text"
                              value={slotNote}
                              onChange={(e) => setSlotNote(e.target.value)}
                              placeholder="e.g. Taken with food, feeling much better..."
                              className="flex-1 p-2 border border-border-subtle rounded-lg text-xs bg-white text-primary"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setActiveNoteSlotKey(null)
                                setSlotNote('')
                              }}
                              className="px-2.5 py-1 text-xs text-text-muted hover:text-primary"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Error Notice */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {error}
                </div>
              )}

              {/* ── Recent Dose Log History ───────────────────── */}
              {recentLogs.length > 0 && (
                <div className="pt-2 border-t border-border-subtle space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                      Recent Activity
                    </h3>
                    <span className="text-[11px] text-text-muted font-mono">
                      {recentLogs.length} logs
                    </span>
                  </div>

                  <div className="bg-white border border-border-subtle rounded-xl divide-y divide-border-subtle shadow-xs overflow-hidden">
                    {recentLogs.slice(0, 7).map((log) => {
                      const logDate = new Date(log.logged_at)
                      const timeStr = logDate.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                      const dateStr = logDate.toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })

                      return (
                        <div
                          key={log.id}
                          className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-surface-secondary/30 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`material-symbols-outlined text-[16px] ${log.taken ? 'text-accent' : 'text-amber-500'
                                }`}
                            >
                              {log.taken ? 'check_circle' : 'cancel'}
                            </span>
                            <span className="text-text-muted text-[11px] font-mono shrink-0">
                              {dateStr} {timeStr}
                            </span>
                            <span className="font-medium text-primary truncate">
                              {log.feeling_tag || log.notes || 'Dose logged'}
                            </span>
                          </div>

                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${log.taken
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                              }`}
                          >
                            {log.taken ? 'Taken' : 'Missed'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  )
}