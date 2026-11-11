'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'
import PrintableCarePlan, { PrintableMedication } from '@/components/care-plan/PrintableCarePlan'

type CarePlan = {
  id: string
  type: string
  details: string
  schedule: string
  created_at?: string
  doctor_id?: string
}

type Medication = {
  id: string
  name: string
  dosage: string | null
  schedule_times: string | null
  instructions: string | null
}

type DoseLog = {
  id: string
  taken: boolean
  feeling_tag: string | null
  notes: string | null
  logged_at: string
}

type CheckInLog = {
  id: string
  report: string
  logged_at: string
}

export default function CarePlanPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState('')
  const [doctorName, setDoctorName] = useState('Your Doctor')
  const [doctorSpecialty, setDoctorSpecialty] = useState('Internal Medicine')
  const [isDischarged, setIsDischarged] = useState(false)
  const [dischargeNotes, setDischargeNotes] = useState('')
  const [carePlan, setCarePlan] = useState<CarePlan | null>(null)
  const [medications, setMedications] = useState<Medication[]>([])
  const [doseLogs, setDoseLogs] = useState<DoseLog[]>([])
  const [checkInLogs, setCheckInLogs] = useState<CheckInLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [notificationStatus, setNotificationStatus] = useState<string>('')

  const router = useRouter()

  useEffect(() => {
    try {
      localStorage.removeItem('mediq_care_plan_has_unread')
      window.dispatchEvent(new CustomEvent('mediq_care_plan_viewed'))
    } catch { }

    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)
      setEmail(user.email || '')

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      if (profile) setFullName(profile.full_name)

      let plan: CarePlan | null = null

      // 1. Try active care plan
      const { data: activePlanData } = await supabase
        .from('care_plans')
        .select('id, type, details, schedule, created_at, doctor_id, active')
        .eq('patient_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (activePlanData) {
        plan = activePlanData
      } else {
        // 2. Check for latest completed/archived care plan
        const { data: pastPlanData } = await supabase
          .from('care_plans')
          .select('id, type, details, schedule, created_at, doctor_id, active')
          .eq('patient_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (pastPlanData) {
          plan = pastPlanData
          setIsDischarged(true)
          if (pastPlanData.details?.toLowerCase().includes('discharge')) {
            setDischargeNotes(pastPlanData.details)
          }
        }
      }

      // 3. Check Enrollment record
      let enrolledDocId: string | null = null
      try {
        const { data: enrollment } = await supabase
          .from('enrollments')
          .select('id, doctor_id, status, initial_notes')
          .eq('patient_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (enrollment) {
          if (enrollment.doctor_id) enrolledDocId = enrollment.doctor_id
          if (enrollment.status === 'completed') {
            setIsDischarged(true)
            if (enrollment.initial_notes && !dischargeNotes) {
              setDischargeNotes(enrollment.initial_notes)
            }
          }
        }
      } catch {
        // Non-blocking
      }

      // 4. Resolve Doctor Id
      let resolvedDocId = plan?.doctor_id || enrolledDocId || null
      if (!resolvedDocId) {
        const { data: caseDoc } = await supabase
          .from('cases')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .not('doctor_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (caseDoc?.doctor_id) resolvedDocId = caseDoc.doctor_id
      }

      if (resolvedDocId) {
        const { data: docProfile } = await supabase
          .from('profiles')
          .select('full_name, specialty')
          .eq('id', resolvedDocId)
          .maybeSingle()
        if (docProfile) {
          setDoctorName(formatDoctorName(docProfile.full_name, 'Your Doctor'))
          setDoctorSpecialty(docProfile.specialty || 'Internal Medicine')
        }
      }

      if (plan) {
        setCarePlan(plan)

        // Fetch medications for this care plan
        const { data: medsData } = await supabase
          .from('medications')
          .select('id, name, dosage, schedule_times, instructions')
          .eq('care_plan_id', plan.id)
          .order('created_at', { ascending: true })

        if (medsData) setMedications(medsData)

        // Dose logs
        const { data: doses } = await supabase
          .from('dose_logs')
          .select('id, taken, feeling_tag, notes, logged_at')
          .eq('care_plans_id', plan.id)
          .order('logged_at', { ascending: false })
          .limit(7)

        if (doses) setDoseLogs(doses)

        // Check-in logs
        const { data: checkIns } = await supabase
          .from('check_in_logs')
          .select('id, report, logged_at')
          .eq('care_plans_id', plan.id)
          .order('logged_at', { ascending: false })
          .limit(5)

        if (checkIns) setCheckInLogs(checkIns)
      }

      setLoading(false)
    }

    loadData()
  }, [router])

  // Group medications by time slots for the daily timeline
  const buildDailyTimeSlots = () => {
    const slotsMap = new Map<string, { time: string; meds: Medication[] }>()

    medications.forEach((med) => {
      if (!med.schedule_times) {
        const key = 'Scheduled Daily'
        if (!slotsMap.has(key)) slotsMap.set(key, { time: key, meds: [] })
        slotsMap.get(key)!.meds.push(med)
        return
      }

      const times = med.schedule_times.split(',').map((t) => t.trim())
      times.forEach((t) => {
        if (!slotsMap.has(t)) slotsMap.set(t, { time: t, meds: [] })
        slotsMap.get(t)!.meds.push(med)
      })
    })

    return Array.from(slotsMap.values())
  }

  // Handle reminder / browser alarm notification setup
  const handleEnableNotifications = async () => {
    if (!('Notification' in window)) {
      setNotificationStatus('Browser notifications are not supported on this device.')
      return
    }

    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      setNotificationStatus('MEDIQ medication alarms and reminders are active on this device.')
      new Notification('MEDIQ Care Plan Reminders Active', {
        body: `You will be alerted at your scheduled medication times (${medications
          .map((m) => m.schedule_times)
          .filter(Boolean)
          .join(', ') || 'as prescribed'}).`,
        icon: '/favicon.ico',
      })
    } else {
      setNotificationStatus('Notification permission was denied in browser settings.')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-text-muted">Loading your Care Plan...</p>
        </div>
      </div>
    )
  }

  const isMedicationPlan = carePlan?.type === 'medication'
  const timeSlots = buildDailyTimeSlots()

  // Format medications for printable preview
  const printableMeds: PrintableMedication[] = medications.map((m) => ({
    name: m.name,
    dosage: m.dosage,
    schedule_times: m.schedule_times,
    instructions: m.instructions,
  }))

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="Care Plan" />
      <TopBar />
      <DesktopHeader />

      <main className="md:ml-64 flex flex-col pb-24 md:pb-12 pt-16 md:pt-0">
        <div className="max-w-[900px] mx-auto w-full px-4 md:px-8 py-6 md:py-8">
          {/* Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-subtle mb-6">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[24px]">assignment</span>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-primary">Your Active Care Plan</h1>
                  <p className="text-xs text-text-muted mt-0.5">
                    Doctor: <strong className="text-primary">{doctorName}</strong> ({doctorSpecialty})
                  </p>
                </div>
              </div>
            </div>

            {carePlan && (
              <div className="flex items-center gap-2.5 self-start sm:self-center">
                <button
                  type="button"
                  onClick={() => setShowPrintModal(true)}
                  className="bg-white border border-border-subtle hover:bg-surface-secondary text-primary px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px] text-accent">print</span>
                  Print Plan / Save PDF
                </button>

                {isMedicationPlan && (
                  <Link
                    href="/log-dose"
                    className="bg-accent hover:bg-[#0c704d] text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">check</span>
                    Log a Dose
                  </Link>
                )}
              </div>
            )}
          </div>

          {!carePlan ? (
            doctorName !== 'Your Doctor' ? (
              <div className="bg-white border border-border-subtle rounded-2xl p-10 flex flex-col items-center justify-center text-center shadow-xs">
                <div className="w-16 h-16 rounded-full bg-accent/10 text-accent flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-[32px]">stethoscope</span>
                </div>
                <h3 className="text-lg font-bold text-primary mb-1">Enrolled with {formatDoctorName(doctorName)}</h3>
                <p className="text-xs text-text-muted max-w-md leading-relaxed">
                  {doctorSpecialty} • Your attending physician has enrolled you and is preparing your personalized care regimen and dosage schedule.
                </p>
                <Link
                  href="/cases"
                  className="mt-6 px-5 py-2.5 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/90 transition-colors shadow-sm inline-flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  <span>Message Your Doctor</span>
                </Link>
              </div>
            ) : (
              <div className="bg-white border border-border-subtle rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-xs">
                <div className="w-16 h-16 rounded-full bg-surface-secondary flex items-center justify-center mb-4 text-text-muted">
                  <span className="material-symbols-outlined text-[32px]">assignment_add</span>
                </div>
                <h3 className="text-lg font-bold text-primary mb-1">No Active Care Plan</h3>
                <p className="text-xs text-text-muted max-w-md leading-relaxed">
                  Your doctor will set up your care plan with medicines and check-in times when they review your health.
                </p>
                <Link
                  href="/submit-case"
                  className="mt-6 px-5 py-2.5 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-[#0c704d] transition-colors shadow-sm"
                >
                  Submit a Case to Doctor
                </Link>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-8">
              {/* ── Celebratory Discharge Milestone Banner ───────────── */}
              {isDischarged && (
                <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <span className="material-symbols-outlined text-[22px]">celebration</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-emerald-950">Treatment Course Completed &amp; Discharged</h3>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Archived Milestone
                        </span>
                      </div>
                      <p className="text-xs text-emerald-900/85 mt-1 leading-relaxed">
                        Your attending physician, <strong>{formatDoctorName(doctorName)}</strong> ({doctorSpecialty}), marked this care regimen as complete. You can view all completed medications and adherence records below.
                      </p>
                      {dischargeNotes && (
                        <p className="text-xs text-emerald-950 font-medium mt-2 italic bg-white/70 p-2.5 rounded-xl border border-emerald-200/60">
                          "{dischargeNotes.replace(/^\[Discharged\]:\s*/i, '')}"
                        </p>
                      )}
                    </div>
                  </div>
                  <Link
                    href="/cases"
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs flex items-center gap-1.5 self-start sm:self-center"
                  >
                    <span>Message Doctor</span>
                    <span className="material-symbols-outlined text-[15px]">chat</span>
                  </Link>
                </div>
              )}
              {/* ── Alarm & Device Reminder Sync Card ────────────────── */}
              {isMedicationPlan && (
                <div className="bg-gradient-to-r from-accent/10 via-accent/5 to-transparent border border-accent/30 rounded-2xl p-5 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                        <span className="material-symbols-outlined text-[22px]">alarm_on</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-primary">Medication Alarms &amp; Daily Reminders</h3>
                          <span className="px-2 py-0.5 rounded-full bg-accent/20 text-accent font-bold text-[10px]">
                            Active
                          </span>
                        </div>
                        <p className="text-xs text-text-muted mt-1">
                          Get alerts on this device when it is time to take your medicines.
                        </p>
                        {notificationStatus && (
                          <p className="text-[11px] text-accent font-medium mt-1 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                            {notificationStatus}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleEnableNotifications}
                      className="px-4 py-2 bg-white border border-accent/40 hover:bg-accent hover:text-white text-accent font-semibold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 shrink-0 self-start sm:self-center cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">notifications_active</span>
                      Enable Device Reminders
                    </button>
                  </div>
                </div>
              )}

              {/* ── Today's Schedule & Alarm Timeline ────────────────── */}
              {isMedicationPlan && timeSlots.length > 0 && (
                <div className="bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-accent text-[20px]">today</span>
                      <h2 className="text-base font-bold text-primary">Today&apos;s Medication Timeline</h2>
                    </div>
                    <span className="text-xs text-text-muted">
                      {timeSlots.length} daily time slot{timeSlots.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {timeSlots.map((slot, sIdx) => (
                      <div
                        key={sIdx}
                        className="bg-[#F9FBFA] border border-[#E0E8E6] rounded-xl p-4 flex flex-col justify-between hover:border-accent/40 transition-all"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#E0E8E6]">
                            <div className="flex items-center gap-1.5 text-accent font-mono font-bold text-xs">
                              <span className="material-symbols-outlined text-[16px]">schedule</span>
                              <span>{slot.time}</span>
                            </div>
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                              Medicine Due
                            </span>
                          </div>

                          <div className="space-y-2">
                            {slot.meds.map((m) => (
                              <div key={m.id} className="text-xs">
                                <div className="flex items-baseline justify-between gap-2">
                                  <strong className="text-primary font-bold">{m.name}</strong>
                                  <span className="text-text-muted font-medium">{m.dosage}</span>
                                </div>
                                {m.instructions && (
                                  <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">
                                    {m.instructions}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-[#E0E8E6] flex items-center justify-between">
                          <span className="text-[11px] text-text-muted">Today&apos;s status</span>
                          <Link
                            href="/log-dose"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                          >
                            <span>Log this dose</span>
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Full Clinical Medication Table (Regimen Matrix) ── */}
              {isMedicationPlan ? (
                <div className="bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-accent text-[20px]">pill</span>
                      <h2 className="text-base font-bold text-primary">Your Prescribed Medicines</h2>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-accent/10 text-accent">
                      {medications.length} Medicine{medications.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {medications.length === 0 ? (
                    <p className="text-xs text-text-muted">No medications have been entered yet.</p>
                  ) : (
                    <div className="overflow-x-auto border border-border-subtle rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-surface-secondary text-text-muted text-[11px] uppercase tracking-wider font-bold border-b border-border-subtle">
                            <th className="py-3 px-4">Medication</th>
                            <th className="py-3 px-4">Dosage</th>
                            <th className="py-3 px-4">Times to Take</th>
                            <th className="py-3 px-4">How to Take</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                          {medications.map((m) => (
                            <tr key={m.id} className="hover:bg-surface-secondary/40 transition-colors">
                              <td className="py-3 px-4 font-bold text-primary">
                                {m.name}
                              </td>
                              <td className="py-3 px-4 font-semibold text-primary whitespace-nowrap">
                                {m.dosage || 'As prescribed'}
                              </td>
                              <td className="py-3 px-4 font-mono text-accent whitespace-nowrap">
                                {m.schedule_times || 'Scheduled'}
                              </td>
                              <td className="py-3 px-4 text-text-muted leading-relaxed">
                                {m.instructions || 'Take with water.'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Cadence info */}
                  <div className="mt-4 pt-3 border-t border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-accent text-[16px]">event_repeat</span>
                      <span>
                        Scheduled Check-in: <strong className="text-primary capitalize">{carePlan.schedule}</strong>
                      </span>
                    </div>
                    <Link href="/check-in" className="text-accent font-semibold hover:underline flex items-center gap-1">
                      <span>Go to Check-In</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  </div>
                </div>
              ) : (
                /* ── Check-In Only Plan ── */
                <div className="bg-white border border-border-subtle rounded-2xl p-6 shadow-xs">
                  <h3 className="text-base font-bold text-primary mb-3">Doctor&apos;s Instructions</h3>
                  <div className="bg-background border border-border-subtle rounded-xl p-4 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[22px]">event_available</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-primary">{carePlan.details}</p>
                      <p className="text-xs text-text-muted mt-1 capitalize">
                        Check-in schedule: <strong>{carePlan.schedule}</strong>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Dose Logs & Adherence History ────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Recent Dose Logs */}
                <div className="bg-white border border-border-subtle rounded-2xl p-5 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-accent text-[18px]">history</span>
                      Recent Dose Log
                    </h3>
                    <Link href="/log-dose" className="text-xs font-semibold text-accent hover:underline">
                      + Log Dose
                    </Link>
                  </div>

                  {doseLogs.length === 0 ? (
                    <p className="text-xs text-text-muted py-4">No doses logged yet.</p>
                  ) : (
                    <div className="divide-y divide-border-subtle">
                      {doseLogs.map((log) => (
                        <div key={log.id} className="py-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className={`material-symbols-outlined text-[18px] ${log.taken ? 'text-accent' : 'text-red-500'
                                }`}
                            >
                              {log.taken ? 'check_circle' : 'cancel'}
                            </span>
                            <div>
                              <p className="font-semibold text-primary">{log.taken ? 'Dose Taken' : 'Dose Missed'}</p>
                              {log.feeling_tag && (
                                <p className="text-[11px] text-text-muted">Feeling: {log.feeling_tag}</p>
                              )}
                            </div>
                          </div>
                          <span className="text-[11px] text-text-muted font-mono">
                            {new Date(log.logged_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Check-Ins */}
                <div className="bg-white border border-border-subtle rounded-2xl p-5 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-accent text-[18px]">clinical_notes</span>
                      Your Past Check-Ins
                    </h3>
                    <Link href="/check-in" className="text-xs font-semibold text-accent hover:underline">
                      + New Check-In
                    </Link>
                  </div>

                  {checkInLogs.length === 0 ? (
                    <p className="text-xs text-text-muted py-4">No check-ins filed yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {checkInLogs.map((log) => (
                        <div key={log.id} className="p-3 bg-surface-secondary border border-border-subtle rounded-xl text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-primary">Check-In</span>
                            <span className="text-[10px] text-text-muted font-mono">
                              {new Date(log.logged_at).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted line-clamp-2">{log.report}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomNav />

      {/* ── Printable Care Plan Modal ── */}
      {showPrintModal && (
        <PrintableCarePlan
          isModal
          patientName={fullName || 'Patient'}
          patientId={userId}
          doctorName={doctorName}
          doctorSpecialty={doctorSpecialty}
          planType={carePlan?.type || 'medication'}
          schedule={carePlan?.schedule || 'every 3 days'}
          details={carePlan?.details}
          carePlanId={carePlan?.id}
          createdAt={carePlan?.created_at}
          medications={printableMeds}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  )
}