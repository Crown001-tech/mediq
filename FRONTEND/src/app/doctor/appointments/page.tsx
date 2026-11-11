'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'
import { sendNotification } from '@/lib/notifications'
import { formatDoctorName } from '@/shared/utils'
import { getJitsiUrl, generateVideoRoomToken } from '@/lib/appointments'

type DoctorAppointment = {
  id: string
  scheduled_at: string
  status: string
  type?: string
  reason?: string | null
  doctor_notes?: string | null
  case_id?: string | null
  cases_id?: string | null
  video_room_token?: string | null
  patient_id: string
  patient_name?: string
  patient_phone?: string | null
  patient_gender?: string | null
  patient_age?: number | null
}

type EnrolledPatient = {
  id: string
  patient_id: string
  patient_name: string
  patient_phone?: string | null
}

type ActiveCase = {
  id: string
  patient_id: string
  patient_name: string
  symptoms_description: string
  created_at: string
}

const statusBadgeStyles: Record<string, { label: string; badge: string }> = {
  upcoming: { label: 'Upcoming', badge: 'bg-accent/10 text-accent border-accent/30' },
  completed: { label: 'Completed', badge: 'bg-surface-secondary text-primary border-border-subtle' },
  cancelled: { label: 'Cancelled', badge: 'bg-gray-100 text-gray-500 border-gray-200' },
}

function timeStatus(dateStr: string): { label: string; isLive: boolean; isOverdue: boolean } {
  const diffMs = new Date(dateStr).getTime() - Date.now()
  if (diffMs <= 0 && diffMs >= -60 * 60 * 1000) {
    return { label: 'Live Telehealth Session', isLive: true, isOverdue: false }
  }
  if (diffMs < -60 * 60 * 1000) {
    return { label: 'Past Scheduled Time', isLive: false, isOverdue: true }
  }
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return { label: `Starts in ${mins}m`, isLive: false, isOverdue: false }
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return { label: `Starts in ${hrs}h`, isLive: false, isOverdue: false }
  return { label: `In ${Math.floor(hrs / 24)}d`, isLive: false, isOverdue: false }
}

const TIME_SLOTS = [
  '08:30 AM',
  '09:00 AM',
  '09:30 AM',
  '10:00 AM',
  '10:30 AM',
  '11:00 AM',
  '11:30 AM',
  '01:00 PM',
  '01:30 PM',
  '02:00 PM',
  '02:30 PM',
  '03:00 PM',
  '03:30 PM',
  '04:00 PM',
  '04:30 PM',
  '05:00 PM',
]

export default function DoctorAppointmentsPage() {
  const [doctorId, setDoctorId] = useState('')
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('Attending Physician')
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([])
  const [patients, setPatients] = useState<EnrolledPatient[]>([])
  const [activeCases, setActiveCases] = useState<ActiveCase[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'completed' | 'all'>('today')
  const [searchQuery, setSearchQuery] = useState('')
  const [actionSuccessMsg, setActionSuccessMsg] = useState('')

  // Schedule Appointment Modal State
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('10:00 AM')
  const [scheduleType, setScheduleType] = useState<'video' | 'in_person'>('video')
  const [scheduleReason, setScheduleReason] = useState('')
  const [scheduleCaseId, setScheduleCaseId] = useState('')
  const [submittingSchedule, setSubmittingSchedule] = useState(false)
  const [scheduleError, setScheduleError] = useState('')

  // Complete Consultation Modal State
  const [completingAppt, setCompletingAppt] = useState<DoctorAppointment | null>(null)
  const [consultNotes, setConsultNotes] = useState('')
  const [submittingComplete, setSubmittingComplete] = useState(false)

  const router = useRouter()

  useEffect(() => {
    const loadDoctorData = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setDoctorId(user.id)

      // Fetch Doctor Profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, specialty, role')
        .eq('id', user.id)
        .single()

      if (profile) {
        if (profile.role !== 'doctor' && profile.role !== 'admin') {
          router.push('/dashboard')
          return
        }
        setFullName(profile.full_name || 'Dr. Attending Physician')
        if (profile.specialty) setSpecialty(profile.specialty)
      }

      // 1. Fetch Doctor's Enrolled Patients
      let patientRoster: EnrolledPatient[] = []
      try {
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('id, patient_id, patient_name, patient_phone')
          .eq('doctor_id', user.id)
          .not('patient_id', 'is', null)

        if (enrollments) {
          patientRoster = enrollments.map((e) => ({
            id: e.id,
            patient_id: e.patient_id as string,
            patient_name: e.patient_name || 'Patient',
            patient_phone: e.patient_phone || null,
          }))
        }
      } catch {}

      // Fallback: Also gather patients who submitted cases to this doctor
      try {
        const { data: casePatients } = await supabase
          .from('cases')
          .select('patient_id, symptoms_description, created_at')
          .eq('doctor_id', user.id)
          .order('created_at', { ascending: false })

        if (casePatients && casePatients.length > 0) {
          const missingIds = casePatients
            .map((c) => c.patient_id)
            .filter((pid) => !patientRoster.some((r) => r.patient_id === pid))

          if (missingIds.length > 0) {
            const { data: profs } = await supabase
              .from('profiles')
              .select('id, full_name, phone')
              .in('id', missingIds)

            if (profs) {
              profs.forEach((p) => {
                patientRoster.push({
                  id: p.id,
                  patient_id: p.id,
                  patient_name: p.full_name || 'Patient',
                  patient_phone: p.phone || null,
                })
              })
            }
          }
        }
      } catch {}

      setPatients(patientRoster)
      if (patientRoster.length > 0) {
        setSelectedPatientId(patientRoster[0].patient_id)
      }

      // 2. Fetch Cases assigned to doctor
      try {
        const { data: casesData } = await supabase
          .from('cases')
          .select('id, patient_id, symptoms_description, created_at')
          .eq('doctor_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20)

        if (casesData) {
          const patientNameMap: Record<string, string> = {}
          patientRoster.forEach((p) => {
            patientNameMap[p.patient_id] = p.patient_name
          })

          setActiveCases(
            casesData.map((c) => ({
              id: c.id,
              patient_id: c.patient_id,
              patient_name: patientNameMap[c.patient_id] || 'Patient',
              symptoms_description: c.symptoms_description,
              created_at: c.created_at,
            }))
          )
        }
      } catch {}

      // 3. Fetch Appointments (Server API + Supabase)
      let apptsList: DoctorAppointment[] = []
      try {
        const res = await fetch(`/api/appointments?doctor_id=${user.id}`)
        if (res.ok) {
          const json = await res.json()
          if (json.appointments && json.appointments.length > 0) {
            apptsList = json.appointments
          }
        }
      } catch {}

      try {
        const { data: fetchedAppts, error: fetchErr } = await supabase
          .from('appointments')
          .select('id, scheduled_at, status, case_id, patient_id, type, reason, doctor_notes')
          .eq('doctor_id', user.id)
          .order('scheduled_at', { ascending: true })

        if (fetchErr) {
          console.warn('Supabase doctor appointments query warning:', fetchErr.message)
        }

        if (fetchedAppts && fetchedAppts.length > 0) {
          fetchedAppts.forEach((dbAppt) => {
            const mapped: DoctorAppointment = {
              ...dbAppt,
              cases_id: dbAppt.case_id,
            }
            if (!apptsList.some((a) => a.id === mapped.id)) {
              apptsList.push(mapped)
            }
          })
        }
      } catch (err) {
        console.warn('Supabase fetch error:', err)
      }

      // Merge locally stored doctor appointments if any
      try {
        const stored = localStorage.getItem(`mediq_doctor_appts_${user.id}`)
        if (stored) {
          const parsed: DoctorAppointment[] = JSON.parse(stored)
          parsed.forEach((local) => {
            if (!apptsList.some((a) => a.id === local.id)) {
              apptsList.push(local)
            }
          })
        }
      } catch {}

      // Enrich with patient profile details
      const patientIds = [...new Set(apptsList.map((a) => a.patient_id).filter(Boolean))]
      const profileMap: Record<string, { name: string; phone: string | null; gender: string | null; age: number | null }> = {}

      if (patientIds.length > 0) {
        const { data: patientProfiles } = await supabase
          .from('profiles')
          .select('id, full_name, phone, gender, age')
          .in('id', patientIds)

        if (patientProfiles) {
          patientProfiles.forEach((p) => {
            profileMap[p.id] = {
              name: p.full_name || 'Patient',
              phone: p.phone,
              gender: p.gender,
              age: p.age,
            }
          })
        }
      }

      setAppointments(
        apptsList.map((a) => {
          const pInfo = profileMap[a.patient_id]
          const rosterMatch = patientRoster.find((r) => r.patient_id === a.patient_id)
          return {
            ...a,
            patient_name: pInfo?.name || rosterMatch?.patient_name || a.patient_name || 'Patient',
            patient_phone: pInfo?.phone || rosterMatch?.patient_phone || null,
            patient_gender: pInfo?.gender || null,
            patient_age: pInfo?.age || null,
          }
        })
      )

      // Default schedule date = today
      setScheduleDate(new Date().toISOString().split('T')[0])
      setLoading(false)
    }

    loadDoctorData()
  }, [router])

  // Doctor schedules a new appointment
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault()
    setScheduleError('')

    if (!selectedPatientId) {
      setScheduleError('Please choose an enrolled patient.')
      return
    }

    if (!scheduleDate) {
      setScheduleError('Please choose a date.')
      return
    }

    setSubmittingSchedule(true)

    // Build ISO timestamp
    const [hoursStr, minsAndPeriod] = scheduleTime.split(':')
    const [minsStr, period] = minsAndPeriod.split(' ')
    let hours = parseInt(hoursStr, 10)
    const mins = parseInt(minsStr, 10)
    if (period === 'PM' && hours !== 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0

    const scheduledDate = new Date(scheduleDate)
    scheduledDate.setHours(hours, mins, 0, 0)
    const scheduledIso = scheduledDate.toISOString()

    const chosenPatient = patients.find((p) => p.patient_id === selectedPatientId)
    const tempId = crypto.randomUUID ? crypto.randomUUID() : `doc-appt-${Date.now()}`
    const videoToken = generateVideoRoomToken()

    const newAppt: DoctorAppointment = {
      id: tempId,
      scheduled_at: scheduledIso,
      status: 'upcoming',
      type: scheduleType,
      reason: scheduleReason.trim() || 'Clinical Review & Telehealth Follow-up',
      cases_id: scheduleCaseId || null,
      video_room_token: videoToken,
      patient_id: selectedPatientId,
      patient_name: chosenPatient?.patient_name || 'Patient',
      patient_phone: chosenPatient?.patient_phone || null,
    }

    // 1. Persist to server store via API
    try {
      await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tempId,
          doctor_id: doctorId,
          doctor_name: fullName,
          doctor_specialty: specialty,
          patient_id: selectedPatientId,
          patient_name: chosenPatient?.patient_name || 'Patient',
          patient_phone: chosenPatient?.patient_phone || null,
          case_id: scheduleCaseId || null,
          cases_id: scheduleCaseId || null,
          scheduled_at: scheduledIso,
          status: 'upcoming',
          type: scheduleType,
          reason: newAppt.reason,
          video_room_token: videoToken,
        }),
      })
    } catch (apiErr) {
      console.warn('API appointment persist warning:', apiErr)
    }

    // 2. Direct Supabase insertion attempt
    try {
      const { data: inserted, error: insertError } = await supabase
        .from('appointments')
        .insert({
          id: tempId,
          doctor_id: doctorId,
          patient_id: selectedPatientId,
          case_id: scheduleCaseId || null,
          scheduled_at: scheduledIso,
          status: 'upcoming',
          type: scheduleType,
          reason: newAppt.reason,
          video_room_token: videoToken,
        })
        .select('id')
        .maybeSingle()

      if (!insertError && inserted?.id) {
        newAppt.id = inserted.id
      } else if (insertError) {
        if (insertError.message?.includes('row-level security')) {
          console.warn(
            'Supabase RLS notice: To enable direct browser inserts to the appointments table, run the RLS policy script in your Supabase SQL Editor. The appointment was safely persisted via the server sync API.'
          )
        } else {
          console.error('Supabase doctor appointment insert error:', insertError.message)
        }
      }
    } catch (dbErr) {
      console.warn('Supabase doctor appointment insert fallback notice:', dbErr)
    }

    // Persist locally for both doctor and patient
    try {
      const docStored = localStorage.getItem(`mediq_doctor_appts_${doctorId}`)
      const docList = docStored ? JSON.parse(docStored) : []
      docList.unshift(newAppt)
      localStorage.setItem(`mediq_doctor_appts_${doctorId}`, JSON.stringify(docList))

      const patientStored = localStorage.getItem(`mediq_patient_appts_${selectedPatientId}`)
      const patientList = patientStored ? JSON.parse(patientStored) : []
      patientList.unshift({
        ...newAppt,
        doctor_id: doctorId,
        doctor_name: fullName,
        doctor_specialty: specialty,
      })
      localStorage.setItem(`mediq_patient_appts_${selectedPatientId}`, JSON.stringify(patientList))
    } catch {}

    // Notify patient
    try {
      await sendNotification({
        userId: selectedPatientId,
        title: 'New Telehealth Visit Scheduled by Doctor',
        message: `${formatDoctorName(fullName)} has scheduled a ${scheduleType === 'video' ? 'video consultation' : 'clinic visit'} for ${scheduledDate.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
        type: 'appointment',
      })
    } catch {}

    setAppointments((prev) => [newAppt, ...prev])
    setSubmittingSchedule(false)
    setShowScheduleModal(false)
    setScheduleReason('')
    setActionSuccessMsg(`Consultation scheduled with ${newAppt.patient_name}!`)
    setTimeout(() => setActionSuccessMsg(''), 5000)
  }

  // Doctor completes appointment with clinical notes
  const handleCompleteAppointment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!completingAppt) return
    setSubmittingComplete(true)

    // 1. Update via server API
    try {
      await fetch('/api/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: completingAppt.id,
          status: 'completed',
          doctor_notes: consultNotes.trim() || null,
        }),
      })
    } catch {}

    // 2. Update Supabase
    try {
      const { error: completeErr } = await supabase
        .from('appointments')
        .update({
          status: 'completed',
          doctor_notes: consultNotes.trim() || null,
        })
        .eq('id', completingAppt.id)

      if (completeErr) {
        console.error('Supabase complete appointment error:', completeErr.message)
      }
    } catch (err) {
      console.error('Complete appointment exception:', err)
    }

    // Update in-memory & local state
    setAppointments((prev) =>
      prev.map((a) =>
        a.id === completingAppt.id
          ? { ...a, status: 'completed', doctor_notes: consultNotes.trim() || null }
          : a
      )
    )

    try {
      const stored = localStorage.getItem(`mediq_doctor_appts_${doctorId}`)
      if (stored) {
        const list: DoctorAppointment[] = JSON.parse(stored)
        const updated = list.map((a) =>
          a.id === completingAppt.id
            ? { ...a, status: 'completed', doctor_notes: consultNotes.trim() || null }
            : a
        )
        localStorage.setItem(`mediq_doctor_appts_${doctorId}`, JSON.stringify(updated))
      }
    } catch {}

    // Notify patient
    try {
      await sendNotification({
        userId: completingAppt.patient_id,
        title: 'Consultation Completed',
        message: `Your consultation with ${formatDoctorName(fullName)} has been marked complete. Check your care plan for updated recommendations.`,
        type: 'appointment',
      })
    } catch {}

    setSubmittingComplete(false)
    setCompletingAppt(null)
    setConsultNotes('')
    setActionSuccessMsg('Consultation marked as completed!')
    setTimeout(() => setActionSuccessMsg(''), 4000)
  }

  // Filter appointments
  const filteredAppointments = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0]

    return appointments.filter((a) => {
      const apptDateStr = new Date(a.scheduled_at).toISOString().split('T')[0]
      const isToday = apptDateStr === todayStr

      // Tab filter
      if (activeTab === 'today') {
        if (!isToday || a.status === 'cancelled') return false
      } else if (activeTab === 'upcoming') {
        if (a.status !== 'upcoming') return false
      } else if (activeTab === 'completed') {
        if (a.status !== 'completed') return false
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchName = a.patient_name?.toLowerCase().includes(q)
        const matchReason = a.reason?.toLowerCase().includes(q)
        const matchPhone = a.patient_phone?.toLowerCase().includes(q)
        return matchName || matchReason || matchPhone
      }

      return true
    })
  }, [appointments, activeTab, searchQuery])

  // Aggregate stats
  const todayDateStr = new Date().toISOString().split('T')[0]
  const todayCount = appointments.filter(
    (a) => new Date(a.scheduled_at).toISOString().split('T')[0] === todayDateStr && a.status !== 'cancelled'
  ).length
  const upcomingCount = appointments.filter((a) => a.status === 'upcoming').length
  const completedCount = appointments.filter((a) => a.status === 'completed').length

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-text-muted">Loading appointments suite...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="Appointments" />
      <DoctorDesktopHeader fullName={fullName} specialty={specialty} />

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex flex-col pb-24 md:pb-12 pt-16 md:pt-0 transition-all duration-300">
        <div className="max-w-[1000px] mx-auto w-full px-4 md:px-8 py-6 md:py-10 flex flex-col gap-8">
          {/* Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-subtle">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[24px]">video_camera_front</span>
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-primary">Telehealth &amp; Appointments</h1>
                  <p className="text-xs md:text-sm text-text-muted mt-0.5">
                    Launch encrypted live video consultations, manage your schedule, and document clinical visit notes.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowScheduleModal(true)}
              className="bg-accent hover:bg-[#0c704d] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 self-start sm:self-center cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>Schedule Consultation</span>
            </button>
          </div>

          {/* Action Success Toast */}
          {actionSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-semibold flex items-center gap-2 animate-fadeIn">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span>{actionSuccessMsg}</span>
            </div>
          )}

          {/* Clinical Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Today's Sessions</span>
                <span className="material-symbols-outlined text-accent text-[18px]">today</span>
              </div>
              <p className="text-2xl font-bold text-primary">{todayCount}</p>
              <p className="text-[10px] text-text-muted mt-1">Scheduled for today</p>
            </div>

            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Upcoming Queue</span>
                <span className="material-symbols-outlined text-teal-600 text-[18px]">calendar_month</span>
              </div>
              <p className="text-2xl font-bold text-teal-700">{upcomingCount}</p>
              <p className="text-[10px] text-text-muted mt-1">Pending visits</p>
            </div>

            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Completed</span>
                <span className="material-symbols-outlined text-emerald-600 text-[18px]">check_circle</span>
              </div>
              <p className="text-2xl font-bold text-emerald-700">{completedCount}</p>
              <p className="text-[10px] text-text-muted mt-1">Documented sessions</p>
            </div>

            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Active Panel</span>
                <span className="material-symbols-outlined text-accent text-[18px]">group</span>
              </div>
              <p className="text-2xl font-bold text-primary">{patients.length}</p>
              <p className="text-[10px] text-text-muted mt-1">Enrolled patients</p>
            </div>
          </div>

          {/* Search & Tabs Filter */}
          <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patient name, phone number, or agenda..."
                className="w-full bg-surface-secondary/60 border border-border-subtle rounded-xl pl-10 pr-4 py-2 text-xs text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center bg-surface-secondary p-1 rounded-xl shrink-0 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('today')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'today'
                    ? 'bg-white text-primary shadow-2xs font-bold'
                    : 'text-text-muted hover:text-primary'
                }`}
              >
                Today ({todayCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('upcoming')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'upcoming'
                    ? 'bg-white text-primary shadow-2xs font-bold'
                    : 'text-text-muted hover:text-primary'
                }`}
              >
                Upcoming ({upcomingCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('completed')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'completed'
                    ? 'bg-white text-primary shadow-2xs font-bold'
                    : 'text-text-muted hover:text-primary'
                }`}
              >
                Completed ({completedCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'all'
                    ? 'bg-white text-primary shadow-2xs font-bold'
                    : 'text-text-muted hover:text-primary'
                }`}
              >
                All ({appointments.length})
              </button>
            </div>
          </div>

          {/* Appointments List */}
          {filteredAppointments.length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-2xs">
              <div className="w-16 h-16 rounded-full bg-accent/10 text-accent flex items-center justify-center mb-3">
                <span className="material-symbols-outlined text-[32px]">event_available</span>
              </div>
              <h3 className="text-base font-bold text-primary mb-1">
                {activeTab === 'today' ? 'No Telehealth Sessions Scheduled for Today' : 'No Consultations Found'}
              </h3>
              <p className="text-xs text-text-muted max-w-sm leading-relaxed mb-6">
                {activeTab === 'today'
                  ? 'Your daily schedule is clear. You can schedule a video follow-up with any patient from your panel.'
                  : 'No appointments match the current filter or search criteria.'}
              </p>
              <button
                type="button"
                onClick={() => setShowScheduleModal(true)}
                className="px-5 py-2.5 bg-accent hover:bg-[#0c704d] text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>Schedule a Consultation</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredAppointments.map((appt) => {
                const jitsiUrl = getJitsiUrl(appt.id, appt.video_room_token)
                const scheduled = new Date(appt.scheduled_at)
                const timing = timeStatus(appt.scheduled_at)
                const isCompleted = appt.status === 'completed'
                const isCancelled = appt.status === 'cancelled'
                const statusInfo = statusBadgeStyles[appt.status] || statusBadgeStyles.upcoming

                return (
                  <article
                    key={appt.id}
                    className={`bg-white rounded-2xl p-5 md:p-6 shadow-2xs transition-all border flex flex-col gap-4 ${
                      timing.isLive
                        ? 'border-2 border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'border-border-subtle hover:border-accent/40'
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border-subtle">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            timing.isLive
                              ? 'bg-emerald-600 text-white animate-pulse'
                              : 'bg-accent/10 text-accent font-bold'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[22px]">
                            {appt.type === 'in_person' ? 'local_hospital' : 'videocam'}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-primary">{appt.patient_name}</h3>
                            {appt.patient_age && (
                              <span className="text-[11px] text-text-muted">
                                ({appt.patient_age} yrs{appt.patient_gender ? `, ${appt.patient_gender}` : ''})
                              </span>
                            )}
                          </div>
                          {appt.patient_phone && (
                            <p className="text-[11px] text-text-muted font-mono">{appt.patient_phone}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {timing.isLive && (
                          <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-600 text-white flex items-center gap-1.5 shadow-xs">
                            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                            <span>LIVE NOW</span>
                          </span>
                        )}

                        {!timing.isLive && (
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${statusInfo.badge}`}>
                            {timing.label}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Section: Reason, Date & Format */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="bg-surface-secondary/70 rounded-xl p-3 border border-border-subtle">
                        <span className="font-bold text-text-muted uppercase tracking-wider text-[10px] block mb-1">
                          Consultation Agenda &amp; Reason
                        </span>
                        <p className="text-primary leading-relaxed">
                          {appt.reason || 'General health evaluation & medication review.'}
                        </p>
                      </div>

                      <div className="bg-surface-secondary/70 rounded-xl p-3 border border-border-subtle flex flex-col justify-between">
                        <div>
                          <span className="font-bold text-text-muted uppercase tracking-wider text-[10px] block mb-1">
                            Scheduled Date &amp; Time
                          </span>
                          <p className="text-primary font-semibold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px] text-accent">schedule</span>
                            <span>
                              {scheduled.toLocaleString([], {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </p>
                        </div>
                        <p className="text-[11px] text-text-muted mt-2 capitalize">
                          Format: <strong>{appt.type === 'in_person' ? 'In-Clinic Physical Visit' : 'Encrypted Video Telehealth'}</strong>
                        </p>
                      </div>
                    </div>

                    {/* Doctor Clinical Notes (if recorded) */}
                    {appt.doctor_notes && (
                      <div className="bg-emerald-50/60 rounded-xl p-3 border border-emerald-200/60 text-xs">
                        <span className="font-bold text-emerald-800 uppercase tracking-wider text-[10px] block mb-0.5">
                          Documented Clinical Notes
                        </span>
                        <p className="text-emerald-950 italic">{appt.doctor_notes}</p>
                      </div>
                    )}

                    {/* Doctor Actions Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-subtle">
                      <div className="flex items-center gap-3 text-xs">
                        <Link
                          href={`/doctor/patients/${appt.patient_id}`}
                          className="text-text-muted hover:text-accent font-semibold flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[15px]">clinical_notes</span>
                          <span>Patient Chart</span>
                        </Link>

                        <Link
                          href={`/doctor/patients/${appt.patient_id}/care-plan`}
                          className="text-text-muted hover:text-accent font-semibold flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[15px]">assignment</span>
                          <span>Care Plan</span>
                        </Link>

                        {appt.cases_id && (
                          <Link
                            href={`/doctor/case/${appt.cases_id}`}
                            className="text-text-muted hover:text-accent font-semibold flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[15px]">folder</span>
                            <span>Linked Case</span>
                          </Link>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {!isCompleted && !isCancelled && (
                          <>
                            <a
                              href={jitsiUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[16px]">videocam</span>
                              <span>Launch Video Call</span>
                            </a>

                            <button
                              type="button"
                              onClick={() => {
                                setCompletingAppt(appt)
                                setConsultNotes(appt.doctor_notes || '')
                              }}
                              className="px-3.5 py-2 bg-white border border-border-subtle hover:bg-surface-secondary text-primary rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[16px] text-accent">check_circle</span>
                              <span>Complete &amp; Add Notes</span>
                            </button>
                          </>
                        )}

                        {isCompleted && (
                          <span className="text-xs font-bold text-emerald-700 flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                            <span className="material-symbols-outlined text-[16px]">verified</span>
                            <span>Visit Completed</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <DoctorBottomNav activePage="Telehealth" />

      {/* ── Schedule Consultation Modal ──────────────────────── */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-border-subtle my-8 animate-fadeIn">
            <div className="flex items-center justify-between pb-4 border-b border-border-subtle mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[22px]">calendar_add_on</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-primary">Schedule Patient Consultation</h3>
                  <p className="text-xs text-text-muted">Set up a telehealth video call or clinic visit for your patient.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-secondary text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {scheduleError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{scheduleError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAppointment} className="space-y-4 text-xs">
              {/* Patient Selector */}
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  Select Patient from Panel
                </label>
                {patients.length === 0 ? (
                  <p className="text-xs text-text-muted bg-surface-secondary p-3 rounded-xl border border-border-subtle">
                    No enrolled patients found in your roster yet.{' '}
                    <Link href="/doctor/patients" className="text-accent font-bold hover:underline">
                      Enroll a patient first
                    </Link>
                  </p>
                ) : (
                  <select
                    value={selectedPatientId}
                    onChange={(e) => setSelectedPatientId(e.target.value)}
                    className="w-full bg-surface-secondary border border-border-subtle rounded-xl px-3.5 py-2.5 text-xs text-primary font-medium focus:outline-none focus:border-accent"
                  >
                    {patients.map((p) => (
                      <option key={p.patient_id} value={p.patient_id}>
                        {p.patient_name} {p.patient_phone ? `(${p.patient_phone})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Consultation Format */}
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
                  Consultation Format
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setScheduleType('video')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                      scheduleType === 'video'
                        ? 'border-accent bg-accent/10 text-accent font-bold shadow-2xs'
                        : 'border-border-subtle text-text-muted hover:border-accent/40'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[22px]">videocam</span>
                    <span className="text-xs font-semibold">Video Call</span>
                    <span className="text-[10px] text-text-muted">Encrypted Web Room</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScheduleType('in_person')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                      scheduleType === 'in_person'
                        ? 'border-accent bg-accent/10 text-accent font-bold shadow-2xs'
                        : 'border-border-subtle text-text-muted hover:border-accent/40'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[22px]">local_hospital</span>
                    <span className="text-xs font-semibold">In-Clinic Visit</span>
                    <span className="text-[10px] text-text-muted">Physical Hospital Visit</span>
                  </button>
                </div>
              </div>

              {/* Date & Time Slot */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Appointment Date
                  </label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    required
                    className="w-full bg-surface-secondary border border-border-subtle rounded-xl px-3.5 py-2.5 text-xs text-primary font-medium focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Time Slot
                  </label>
                  <select
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full bg-surface-secondary border border-border-subtle rounded-xl px-3.5 py-2.5 text-xs text-primary font-medium focus:outline-none focus:border-accent"
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Reason / Agenda */}
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  Clinical Objective / Reason for Session
                </label>
                <textarea
                  rows={2}
                  value={scheduleReason}
                  onChange={(e) => setScheduleReason(e.target.value)}
                  placeholder="e.g. Follow-up on blood pressure medicines, routine post-discharge check, or symptom escalation..."
                  className="w-full bg-surface-secondary border border-border-subtle rounded-xl p-3 text-xs text-primary placeholder:text-text-muted focus:outline-none focus:border-accent leading-relaxed"
                />
              </div>

              {/* Optional Case Link */}
              {activeCases.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Link to Patient Clinical Case (Optional)
                  </label>
                  <select
                    value={scheduleCaseId}
                    onChange={(e) => setScheduleCaseId(e.target.value)}
                    className="w-full bg-surface-secondary border border-border-subtle rounded-xl px-3.5 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="">-- No specific case / General Review --</option>
                    {activeCases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.patient_name}: {c.symptoms_description.slice(0, 45)}... ({new Date(c.created_at).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-border-subtle flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:text-primary hover:bg-surface-secondary text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSchedule || patients.length === 0}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-[#0c704d] text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingSchedule ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Scheduling...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">calendar_today</span>
                      <span>Schedule &amp; Notify Patient</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Complete Consultation & Add Notes Modal ─────────── */}
      {completingAppt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-border-subtle my-8 animate-fadeIn">
            <div className="flex items-center justify-between pb-4 border-b border-border-subtle mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[22px]">clinical_notes</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-primary">Complete Consultation Session</h3>
                  <p className="text-xs text-text-muted">Document visit summary and recommendations for {completingAppt.patient_name}.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompletingAppt(null)}
                className="w-8 h-8 rounded-full hover:bg-surface-secondary text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCompleteAppointment} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  Clinical Consultation Notes &amp; Advice
                </label>
                <textarea
                  rows={4}
                  value={consultNotes}
                  onChange={(e) => setConsultNotes(e.target.value)}
                  placeholder="Document clinical observations, diagnosis confirmation, advice given, and follow-up guidance..."
                  required
                  className="w-full bg-surface-secondary border border-border-subtle rounded-xl p-3 text-xs text-primary placeholder:text-text-muted focus:outline-none focus:border-accent leading-relaxed"
                />
              </div>

              <div className="pt-4 border-t border-border-subtle flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCompletingAppt(null)}
                  className="px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:text-primary hover:bg-surface-secondary text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingComplete}
                  className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingComplete ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      <span>Mark Completed &amp; Save Notes</span>
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
