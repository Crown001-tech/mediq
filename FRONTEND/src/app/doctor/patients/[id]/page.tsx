'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications'
import { formatDoctorName } from '@/shared/utils'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'
import PrintableCarePlan, { PrintableMedication } from '@/components/care-plan/PrintableCarePlan'
import {
  parseMedicationDuration,
  evaluateCheckInStatus,
  autoReconcileMissedDoses,
  calculateLongitudinalAdherence,
  calculateMedicationAdherence,
  calculateCheckInCompliance,
} from '@/lib/adherence'

type CaseItem = {
  id: string
  symptoms_description: string
  status: string
  created_at: string
}

type CarePlanRecord = {
  id: string
  type: string
  details: string
  schedule: string
  created_at?: string
}

type DoseLogItem = {
  id: string
  taken: boolean
  feeling_tag: string | null
  notes: string | null
  logged_at: string
}

type CheckInLogItem = {
  id: string
  report: string
  logged_at: string
}

export default function PatientDetailPage() {
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [patientName, setPatientName] = useState('')
  const [cases, setCases] = useState<CaseItem[]>([])
  const [hasActivePlan, setHasActivePlan] = useState(false)
  const [carePlanData, setCarePlanData] = useState<CarePlanRecord | null>(null)
  const [carePlanMeds, setCarePlanMeds] = useState<PrintableMedication[]>([])
  const [doseLogs, setDoseLogs] = useState<DoseLogItem[]>([])
  const [checkInLogs, setCheckInLogs] = useState<CheckInLogItem[]>([])
  const [activeTab, setActiveTab] = useState<'adherence' | 'checkins' | 'cases'>('adherence')
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [loading, setLoading] = useState(true)

  // Care Plan Lifecycle & Discharge State
  const [enrollmentStatus, setEnrollmentStatus] = useState<string>('active')
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null)
  const [showDischargeModal, setShowDischargeModal] = useState(false)
  const [dischargeNotes, setDischargeNotes] = useState('')
  const [discharging, setDischarging] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const router = useRouter()
  const params = useParams()
  const patientId = (params?.id as string) || ''

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    // 1. Fetch Doctor Profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, specialty, role, verified')
      .eq('id', user.id)
      .maybeSingle()

    if (profile) {
      setFullName(profile.full_name || 'Doctor')
      setSpecialty(profile.specialty || '')
    }

    // 2. Fetch Real Patient Profile
    const { data: patientProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', patientId)
      .maybeSingle()

    if (patientProfile?.full_name) {
      setPatientName(patientProfile.full_name.trim())
    } else {
      setPatientName(`Patient #${patientId.slice(0, 5).toUpperCase()}`)
    }

    // 2.1 Fetch Enrollment Status
    try {
      const { data: enrollData } = await supabase
        .from('enrollments')
        .select('id, status, initial_notes, enrolled_at')
        .eq('patient_id', patientId)
        .eq('doctor_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (enrollData) {
        setEnrollmentStatus(enrollData.status || 'active')
        setEnrollmentId(enrollData.id)
      }
    } catch {
      // Table may not be active yet
    }

    // 3. Fetch Real Patient Cases
    const { data: patientCases } = await supabase
      .from('cases')
      .select('id, symptoms_description, status, created_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })

    setCases(patientCases || [])

    // 4. Fetch Real Active Care Plan (Ordered by latest, with duplicate cleanup)
    const { data: activePlans } = await supabase
      .from('care_plans')
      .select('id, type, details, schedule, created_at')
      .eq('patient_id', patientId)
      .eq('active', true)
      .order('created_at', { ascending: false })

    const activePlan = activePlans && activePlans.length > 0 ? activePlans[0] : null

    // Self-heal: If historical duplicate active rows exist, mark older ones inactive
    if (activePlans && activePlans.length > 1) {
      const duplicateIds = activePlans.slice(1).map((p) => p.id)
      supabase
        .from('care_plans')
        .update({ active: false })
        .in('id', duplicateIds)
        .then(() => {})
    }

    let activeMeds: PrintableMedication[] = []

    if (activePlan) {
      setHasActivePlan(true)
      setCarePlanData(activePlan)

      // Fetch Real Medications for this plan
      const { data: meds } = await supabase
        .from('medications')
        .select('name, dosage, schedule_times, instructions')
        .eq('care_plan_id', activePlan.id)
        .order('created_at', { ascending: true })

      if (meds && meds.length > 0) {
        activeMeds = meds.map((m) => ({
          name: m.name,
          dosage: m.dosage,
          schedule_times: m.schedule_times,
          instructions: m.instructions,
        }))
        setCarePlanMeds(activeMeds)
      } else {
        setCarePlanMeds([])
      }

      // Run 12-hour auto-miss reconciliation silently in the background
      await autoReconcileMissedDoses(
        supabase,
        activePlan.id,
        patientId,
        activeMeds.map((m) => ({ id: m.name, instructions: m.instructions, schedule_times: m.schedule_times })),
        activePlan.created_at
      )
    } else {
      setHasActivePlan(false)
      setCarePlanData(null)
      setCarePlanMeds([])
    }

    // 5. Fetch Patient Dose Logs (including auto-marked ones)
    try {
      const { data: logsData } = await supabase
        .from('dose_logs')
        .select('id, taken, feeling_tag, notes, logged_at')
        .eq('patient_id', patientId)
        .order('logged_at', { ascending: false })
        .limit(30)

      if (logsData) setDoseLogs(logsData)
    } catch {
      setDoseLogs([])
    }

    // 6. Fetch Patient Check-In Logs
    try {
      const { data: checkInsData } = await supabase
        .from('check_in_logs')
        .select('id, report, logged_at')
        .eq('patient_id', patientId)
        .order('logged_at', { ascending: false })
        .limit(10)

      if (checkInsData) setCheckInLogs(checkInsData)
    } catch {
      setCheckInLogs([])
    }

    setLoading(false)
  }, [patientId, router])

  useEffect(() => {
    if (patientId) loadData()
  }, [patientId, loadData])

  // ── 1. Calculate Overdue Check-In (Primary Clinical Red Flag) ──
  const checkInStatus = useMemo(() => {
    return evaluateCheckInStatus(
      carePlanData?.schedule,
      checkInLogs[0]?.logged_at,
      carePlanData?.created_at
    )
  }, [carePlanData, checkInLogs])

  // ── 2. Calculate Dose Adherence with 12-Hour Auto-Miss Windows ──
  const adherenceMetrics = useMemo(() => {
    if (!hasActivePlan || carePlanMeds.length === 0) {
      return {
        adherenceRate: null,
        takenCount: 0,
        missedCount: 0,
        autoMissedCount: 0,
        lastLoggedStr: 'No active regimen',
        isAwaitingFirstWindow: true,
      }
    }

    const takenCount = doseLogs.filter((l) => l.taken).length
    const missedCount = doseLogs.filter((l) => !l.taken).length
    const autoMissedCount = doseLogs.filter((l) => !l.taken && l.notes?.toLowerCase().includes('auto-mark')).length
    const totalEvaluated = takenCount + missedCount

    let adherenceRate: number | null = null
    let isAwaitingFirstWindow = false

    if (totalEvaluated === 0) {
      isAwaitingFirstWindow = true
    } else {
      adherenceRate = Math.round((takenCount / totalEvaluated) * 100)
    }

    const latestLog = doseLogs[0]
    let daysSinceLastLog: number | null = null
    let missedDoseFlag: string | null = null

    if (latestLog) {
      const diffMs = Date.now() - new Date(latestLog.logged_at).getTime()
      daysSinceLastLog = Math.floor(diffMs / (24 * 60 * 60 * 1000))
      if (daysSinceLastLog >= 2) {
        missedDoseFlag = `Last dose logged ${daysSinceLastLog} days ago`
      }
    } else if (carePlanData?.created_at) {
      const diffMs = Date.now() - new Date(carePlanData.created_at).getTime()
      const daysSincePlan = Math.floor(diffMs / (24 * 60 * 60 * 1000))
      if (daysSincePlan >= 2) {
        missedDoseFlag = `No doses logged in ${daysSincePlan} days`
      }
    }

    const lastLoggedStr = latestLog
      ? new Date(latestLog.logged_at).toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'No doses logged yet'

    return {
      adherenceRate,
      takenCount,
      missedCount,
      autoMissedCount,
      lastLoggedStr,
      isAwaitingFirstWindow,
      missedDoseFlag,
    }
  }, [hasActivePlan, carePlanMeds, doseLogs, carePlanData])

  const longitudinalDays = useMemo(() => {
    return calculateLongitudinalAdherence(doseLogs, carePlanData?.created_at)
  }, [doseLogs, carePlanData?.created_at])

  const medicationStats = useMemo(() => {
    return calculateMedicationAdherence(carePlanMeds, doseLogs)
  }, [carePlanMeds, doseLogs])

  const checkInCompliance = useMemo(() => {
    return calculateCheckInCompliance(carePlanData?.schedule, carePlanData?.created_at, checkInLogs)
  }, [carePlanData?.schedule, carePlanData?.created_at, checkInLogs])

  const handleDischarge = async (e: React.FormEvent) => {
    e.preventDefault()
    setDischarging(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // 1. Deactivate active care plan(s)
      if (carePlanData?.id) {
        const updatedDetails = carePlanData.details
          ? `${carePlanData.details} — [Discharged]: ${dischargeNotes.trim() || 'Treatment marked complete.'}`
          : `[Discharged]: ${dischargeNotes.trim() || 'Treatment marked complete.'}`

        await supabase
          .from('care_plans')
          .update({
            active: false,
            details: updatedDetails,
          })
          .eq('patient_id', patientId)
      }

      // 2. Update enrollment status to 'completed'
      if (enrollmentId) {
        await supabase
          .from('enrollments')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollmentId)
      } else {
        await supabase
          .from('enrollments')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('patient_id', patientId)
          .eq('doctor_id', user?.id)
      }

      // 3. Send celebratory in-app notification to patient
      await sendNotification({
        userId: patientId,
        title: '🎉 Treatment Course Completed!',
        message: `${formatDoctorName(fullName, 'Your physician')} has marked your clinical treatment course as complete. ${
          dischargeNotes.trim()
            ? `Discharge instructions: ${dischargeNotes.trim()}`
            : 'Great job staying committed to your recovery!'
        }`,
        type: 'care_plan',
      })

      setHasActivePlan(false)
      setEnrollmentStatus('completed')
      setShowDischargeModal(false)
      setDischargeNotes('')
      setToastMessage('Patient successfully discharged. Treatment course marked complete.')
      setTimeout(() => setToastMessage(null), 4500)
    } catch (err: any) {
      console.error('Error discharging patient:', err)
    } finally {
      setDischarging(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-text-muted">Loading patient clinical record...</p>
        </div>
      </div>
    )
  }

  const patientInitial = patientName ? patientName.charAt(0).toUpperCase() : 'P'

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="My Patients" />
      <DoctorDesktopHeader fullName={fullName} />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-700 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in duration-200">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span>{toastMessage}</span>
        </div>
      )}

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex flex-col pb-24 md:pb-12 pt-16 md:pt-0 transition-all duration-300 ease-in-out">
        <div className="max-w-[960px] mx-auto w-full px-4 md:px-8 py-6 md:py-8">
          <Link
            href="/doctor/patients"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline mb-6 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to Patients
          </Link>

          {/* Patient Profile Card */}
          <div className="bg-white border border-border-subtle rounded-xl p-5 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shadow-xs">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-xl select-none shrink-0 border border-accent/20">
                {patientInitial}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-bold text-primary">{patientName}</h1>
                  {enrollmentStatus === 'completed' ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-xs font-semibold text-emerald-800 border border-emerald-300 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px] text-emerald-600">check_circle</span>
                      Treatment Completed
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-secondary text-xs font-semibold text-text-muted border border-border-subtle">
                      Enrolled
                    </span>
                  )}
                </div>
                <p className="text-xs md:text-sm text-text-muted mt-1 flex items-center gap-2">
                  <span className="font-mono">ID: #{patientId.slice(0, 8).toUpperCase()}</span>
                  <span>•</span>
                  <span>
                    {hasActivePlan ? 'Active Care Plan' : enrollmentStatus === 'completed' ? 'Discharged (Archived)' : 'No Care Plan'}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-start sm:self-center">
              {!hasActivePlan ? (
                <button
                  type="button"
                  onClick={() => router.push(`/doctor/patients/${patientId}/care-plan`)}
                  className="bg-accent text-white text-xs font-semibold px-4 py-2.5 rounded-lg hover:bg-[#0c704d] transition-colors whitespace-nowrap inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">add_circle</span>
                  {enrollmentStatus === 'completed' ? 'Initiate New Care Plan' : 'Create Care Plan'}
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setShowPrintModal(true)}
                    className="bg-accent text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#0c704d] transition-colors whitespace-nowrap inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">print</span>
                    Print Plan
                  </button>
                  <Link
                    href={`/doctor/patients/${patientId}/care-plan`}
                    className="bg-white border border-border-subtle text-primary hover:bg-surface-secondary text-xs font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1 shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[15px]">edit</span>
                    Edit Plan
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setDischargeNotes('Patient completed prescribed recovery regimen. Symptoms resolved and vital signs are stable.')
                      setShowDischargeModal(true)
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1 shadow-xs cursor-pointer"
                    title="Discharge patient and conclude active care plan"
                  >
                    <span className="material-symbols-outlined text-[15px]">task_alt</span>
                    Discharge
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Treatment Completed Banner */}
          {enrollmentStatus === 'completed' && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-900 shadow-xs mb-6 animate-in fade-in duration-200">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">verified</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm text-emerald-950">
                    Treatment Successfully Completed &amp; Discharged
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900 text-[10px] font-bold">
                    Archived Cohort
                  </span>
                </div>
                <p className="text-xs text-emerald-800 mt-1">
                  This patient has completed their prescribed regimen. Recovery check-ins and dose schedules are safely archived in clinical history.
                </p>
              </div>
            </div>
          )}

          {/* Missed Check-In Alert (Suppressed if treatment is completed) */}
          {hasActivePlan && enrollmentStatus !== 'completed' && checkInStatus.isOverdue && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-900 shadow-xs mb-6 animate-in fade-in duration-200">
              <div className="w-9 h-9 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">warning</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm text-red-950">
                    Check-In Overdue
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-red-200 text-red-900 text-[10px] font-bold">
                    {checkInStatus.daysOverdue} {checkInStatus.daysOverdue === 1 ? 'day' : 'days'} late
                  </span>
                </div>
                <p className="text-xs text-red-800 mt-1">
                  Expected check-in: {checkInStatus.cadenceLabel.toLowerCase()}. Last check-in: {checkInStatus.lastReportStr}.
                </p>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('checkins')}
                    className="text-xs font-semibold text-red-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    View check-ins &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Adherence & Regimen Summary Grid */}
          {hasActivePlan ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Card 1: Dose Adherence Score */}
              <div className="bg-white border border-border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Medication Adherence
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-text-muted">
                      medication
                    </span>
                  </div>

                  {adherenceMetrics.isAwaitingFirstWindow ? (
                    <div className="py-2">
                      <span className="text-sm font-semibold text-text-muted">Awaiting Logs</span>
                      <p className="text-[11px] text-text-muted mt-1">
                        Waiting for first dose log.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`text-3xl font-extrabold tracking-tight ${
                            (adherenceMetrics.adherenceRate ?? 0) >= 75
                              ? 'text-emerald-700'
                              : (adherenceMetrics.adherenceRate ?? 0) >= 50
                              ? 'text-amber-700'
                              : 'text-red-600'
                          }`}
                        >
                          {adherenceMetrics.adherenceRate}%
                        </span>
                        <span className="text-xs text-text-muted font-medium">taken</span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-1.5 bg-surface-secondary rounded-full mt-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            (adherenceMetrics.adherenceRate ?? 0) >= 75
                              ? 'bg-emerald-600'
                              : (adherenceMetrics.adherenceRate ?? 0) >= 50
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${adherenceMetrics.adherenceRate}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-border-subtle mt-3 text-[11px] text-text-muted flex justify-between">
                  <span>{adherenceMetrics.takenCount} taken</span>
                  <span>{adherenceMetrics.missedCount} missed</span>
                </div>
              </div>

              {/* Card 2: Check-In Status & Compliance */}
              <div className="bg-white border border-border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Check-In Compliance
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-text-muted">
                      rate_review
                    </span>
                  </div>

                  <div className="py-1">
                    <span className="text-base font-bold text-primary block">
                      {checkInCompliance.complianceRate}% Compliance
                    </span>
                    <p className="text-xs text-text-muted mt-0.5">
                      {checkInCompliance.statusText}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-border-subtle mt-3 flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      checkInCompliance.isOverdue
                        ? 'bg-red-100 text-red-800'
                        : 'bg-emerald-50 text-emerald-800'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        checkInCompliance.isOverdue ? 'bg-red-600' : 'bg-emerald-600'
                      }`}
                    />
                    {checkInCompliance.isOverdue ? 'Overdue' : 'Up to date'}
                  </span>
                  <span className="text-[11px] text-text-muted font-mono">
                    Cadence: {checkInStatus.cadenceLabel}
                  </span>
                </div>
              </div>

              {/* Card 3: Last Dose */}
              <div className="bg-white border border-border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Last Dose Logged
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-text-muted">
                      schedule
                    </span>
                  </div>

                  <div className="py-1">
                    <span className="text-sm font-semibold text-primary block">
                      {adherenceMetrics.lastLoggedStr}
                    </span>
                    <p className="text-[11px] text-text-muted mt-1">
                      {carePlanMeds.length} medication{carePlanMeds.length !== 1 ? 's' : ''}
                    </p>

                    {adherenceMetrics.missedDoseFlag && (
                      <div className="mt-2.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {adherenceMetrics.missedDoseFlag}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-border-subtle mt-3 text-[11px] text-text-muted flex items-center justify-between">
                  <span>Auto-marks missed after 12h</span>
                  {adherenceMetrics.autoMissedCount > 0 && (
                    <span className="font-mono text-amber-700 font-medium">
                      {adherenceMetrics.autoMissedCount} auto-marked
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 bg-surface-secondary/50 border border-border-subtle rounded-xl mb-6 text-center text-xs text-text-muted">
              No active care plan yet. Create a care plan to start tracking doses and check-ins.
            </div>
          )}

          {/* 14-Day Longitudinal Adherence Activity Strip */}
          {hasActivePlan && (
            <div className="bg-white border border-border-subtle rounded-xl p-5 mb-6 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-accent text-[18px]">timeline</span>
                    14-Day Adherence Timeline
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Day-by-day compliance record for the past two weeks.
                  </p>
                </div>

                {/* Micro Legend */}
                <div className="flex items-center gap-3 text-[11px] text-text-muted flex-wrap">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    Full
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    Partial
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    Missed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    Today
                  </span>
                </div>
              </div>

              {/* Day Dots Grid */}
              <div className="grid grid-cols-7 sm:grid-cols-14 gap-1.5 pt-2">
                {longitudinalDays.map((d, idx) => {
                  let badgeBg = 'bg-surface-secondary text-text-muted border-border-subtle'
                  let dotBg = 'bg-text-muted/40'

                  if (d.status === 'full') {
                    badgeBg = 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    dotBg = 'bg-emerald-600'
                  } else if (d.status === 'partial') {
                    badgeBg = 'bg-amber-50 text-amber-800 border-amber-200'
                    dotBg = 'bg-amber-600'
                  } else if (d.status === 'missed') {
                    badgeBg = 'bg-red-50 text-red-800 border-red-200'
                    dotBg = 'bg-red-600'
                  } else if (d.status === 'today_pending') {
                    badgeBg = 'bg-blue-50 text-blue-800 border-blue-200'
                    dotBg = 'bg-blue-500 animate-pulse'
                  }

                  return (
                    <div
                      key={idx}
                      title={d.tooltip}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all hover:scale-105 select-none ${badgeBg}`}
                    >
                      <span className="text-[10px] font-semibold block uppercase">
                        {d.dayLabel}
                      </span>
                      <span className={`w-2.5 h-2.5 rounded-full mt-1.5 ${dotBg}`} />
                      <span className="text-[10px] font-mono mt-1 text-text-muted">
                        {d.status === 'today_pending' ? 'Today' : d.totalScheduled > 0 ? `${d.takenCount}/${d.totalScheduled}` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Prescribed Medications with Per-Drug Adherence Breakdown */}
          {hasActivePlan && carePlanMeds.length > 0 && (
            <div className="bg-white border border-border-subtle rounded-xl p-5 mb-6 shadow-xs">
              <div className="flex items-center justify-between mb-3.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-accent text-[18px]">pill</span>
                  Prescribed Medications &amp; Drug Compliance
                </h3>
                <span className="text-xs text-text-muted">{carePlanMeds.length} medications</span>
              </div>

              <div className="divide-y divide-border-subtle">
                {carePlanMeds.map((med, idx) => {
                  const durationInfo = parseMedicationDuration(med.instructions, carePlanData?.created_at)
                  const medStat = medicationStats.find(
                    (s) => s.medName.toLowerCase() === med.name.toLowerCase()
                  )

                  return (
                    <div key={idx} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-primary">{med.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-md bg-surface-secondary text-text-muted font-medium">
                            {med.dosage}
                          </span>

                          {/* Per-Medication Adherence Pill */}
                          {medStat && medStat.adherenceRate !== null ? (
                            <span
                              className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border inline-flex items-center gap-1 ${
                                medStat.status === 'on_track'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : medStat.status === 'warning'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-red-50 text-red-800 border-red-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  medStat.status === 'on_track'
                                    ? 'bg-emerald-600'
                                    : medStat.status === 'warning'
                                    ? 'bg-amber-600'
                                    : 'bg-red-600'
                                }`}
                              />
                              {medStat.statusText}
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-surface-secondary text-text-muted border border-border-subtle">
                              Awaiting logs
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-muted mt-1">
                          Timing: <strong>{med.schedule_times || 'Daily'}</strong> • {med.instructions}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                        <span
                          className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
                            durationInfo.isCompleted
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-accent/10 text-accent'
                          }`}
                        >
                          {durationInfo.progressText}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── 5. Detailed Audit Activity Tabs ─────────────── */}
          <div className="border-b border-border-subtle mb-4 flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('adherence')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors relative cursor-pointer ${
                activeTab === 'adherence'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-primary'
              }`}
            >
              Dose Logs ({doseLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('checkins')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors relative flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'checkins'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-primary'
              }`}
            >
              Check-Ins ({checkInLogs.length})
              {checkInStatus.isOverdue && (
                <span className="w-2 h-2 rounded-full bg-red-600" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('cases')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors relative cursor-pointer ${
                activeTab === 'cases'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-primary'
              }`}
            >
              Cases ({cases.length})
            </button>
          </div>

          {/* Tab Content 1: Dose Logs */}
          {activeTab === 'adherence' && (
            <div>
              {doseLogs.length === 0 ? (
                <div className="bg-white border border-border-subtle rounded-xl p-8 text-center text-xs text-text-muted">
                  No doses logged yet.
                </div>
              ) : (
                <div className="bg-white border border-border-subtle rounded-xl overflow-hidden shadow-xs divide-y divide-border-subtle">
                  {doseLogs.map((log) => (
                    <div key={log.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                            log.taken ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {log.taken ? 'done' : 'close'}
                          </span>
                        </span>
                        <div>
                          <p className="font-semibold text-primary">
                            {log.taken ? 'Dose Taken' : 'Dose Missed'}
                          </p>
                          <p className="text-[11px] text-text-muted mt-0.5">{log.notes || 'Dose recorded'}</p>
                        </div>
                      </div>

                      <div className="text-right text-text-muted text-[11px] shrink-0">
                        {new Date(log.logged_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab Content 2: Check-In Reports */}
          {activeTab === 'checkins' && (
            <div>
              {checkInLogs.length === 0 ? (
                <div className="bg-white border border-border-subtle rounded-xl p-8 text-center text-xs text-text-muted">
                  No check-ins submitted yet.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {checkInLogs.map((item) => (
                    <div key={item.id} className="bg-white border border-border-subtle rounded-xl p-4 shadow-xs">
                      <div className="flex items-center justify-between text-xs text-text-muted mb-1.5">
                        <span className="font-semibold text-accent flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">verified</span>
                          Check-In Report
                        </span>
                        <span>
                          {new Date(item.logged_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-primary leading-relaxed">{item.report}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab Content 3: Cases */}
          {activeTab === 'cases' && (
            <div>
              {cases.length === 0 ? (
                <div className="bg-white border border-border-subtle rounded-xl p-8 text-center text-xs text-text-muted">
                  No cases recorded.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {cases.map((c) => {
                    const isPending = c.status === 'pending' || c.status === 'in_review'
                    return (
                      <div
                        key={c.id}
                        onClick={() => router.push(`/doctor/case/${c.id}`)}
                        className="bg-white border border-border-subtle rounded-xl p-4.5 flex items-center justify-between gap-3 shadow-xs hover:border-accent/40 hover:shadow-sm transition-all cursor-pointer group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary group-hover:text-accent transition-colors line-clamp-2">
                            {c.symptoms_description}
                          </p>
                          <div className="flex items-center gap-2.5 mt-2 text-xs text-text-muted">
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                              {new Date(c.created_at).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                            <span>•</span>
                            <span
                              className={`capitalize px-2 py-0.5 rounded text-[11px] font-semibold ${
                                isPending
                                  ? 'bg-accent/10 text-accent'
                                  : 'bg-surface-secondary text-text-muted'
                              }`}
                            >
                              {c.status.replace('_', ' ')}
                            </span>
                          </div>
                        </div>

                        <div className="w-8 h-8 rounded-full bg-surface-secondary group-hover:bg-accent group-hover:text-white text-text-muted flex items-center justify-center transition-all shrink-0">
                          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <DoctorBottomNav />

      {/* Printable Care Plan Modal */}
      {showPrintModal && (
        <PrintableCarePlan
          isModal
          patientName={patientName}
          patientId={patientId}
          demographics="Registered Patient"
          doctorName={fullName || 'Doctor'}
          doctorSpecialty={specialty || 'General Practice'}
          planType={carePlanData?.type || 'medication'}
          schedule={carePlanData?.schedule || 'every 3 days'}
          details={carePlanData?.details}
          carePlanId={carePlanData?.id}
          createdAt={carePlanData?.created_at}
          medications={carePlanMeds}
          onClose={() => setShowPrintModal(false)}
        />
      )}

      {/* Discharge / Complete Treatment Modal */}
      {showDischargeModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-border-subtle animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle mb-4">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-base">
                <span className="material-symbols-outlined text-[22px] text-emerald-600">task_alt</span>
                <h3>Discharge &amp; Conclude Treatment</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDischargeModal(false)}
                className="text-text-muted hover:text-primary transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="mb-4 bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3.5 text-xs text-emerald-900 leading-relaxed">
              <span className="font-semibold block mb-0.5">Clinical Handover &amp; Resolution:</span>
              Marking this care plan complete will transition <strong>{patientName}</strong> to your <em>Archived / Completed</em> cohort, stop overdue check-in alerts, and send a celebratory discharge summary to the patient.
            </div>

            <form onSubmit={handleDischarge} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-primary mb-1.5">
                  Clinical Discharge Summary &amp; Recommendations
                </label>
                <textarea
                  rows={4}
                  value={dischargeNotes}
                  onChange={(e) => setDischargeNotes(e.target.value)}
                  placeholder="e.g., Completed full 14-day antibiotic regimen. Symptoms resolved, vital signs stable. Advised routine follow-up as needed."
                  className="w-full text-xs p-3 border border-border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 bg-surface-secondary/40 text-primary"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={discharging}
                  onClick={() => setShowDischargeModal(false)}
                  className="px-4 py-2 border border-border-subtle rounded-xl text-xs font-semibold text-text-muted hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={discharging}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  {discharging ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Completing...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">check</span>
                      <span>Confirm Discharge &amp; Mark Complete</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}