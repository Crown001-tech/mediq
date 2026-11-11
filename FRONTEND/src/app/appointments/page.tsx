'use client'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'
import { sendNotification } from '@/lib/notifications'
import { getJitsiUrl, generateVideoRoomToken } from '@/lib/appointments'

type Appointment = {
  id: string
  scheduled_at: string
  status: string
  type?: string
  reason?: string | null
  case_id?: string | null
  cases_id?: string | null
  video_room_token?: string | null
  doctor_id: string
  doctor_name?: string
  doctor_specialty?: string
}

type DoctorOption = {
  id: string
  full_name: string
  specialty: string | null
}

type PatientCaseOption = {
  id: string
  symptoms_description: string
  created_at: string
}

const statusStyles: Record<string, { badge: string; label: string }> = {
  upcoming: {
    badge: 'bg-accent/10 text-accent border border-accent/30',
    label: 'Upcoming',
  },
  completed: {
    badge: 'bg-surface-secondary text-primary border border-border-subtle',
    label: 'Completed',
  },
  cancelled: {
    badge: 'bg-gray-100 text-gray-500 border border-gray-200',
    label: 'Cancelled',
  },
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'Live Now'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  return `in ${Math.floor(hrs / 24)}d`
}

const TIME_SLOTS = [
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

function AppointmentsContent() {
  const [userId, setUserId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [patientCases, setPatientCases] = useState<PatientCaseOption[]>([])
  const [defaultDoctorId, setDefaultDoctorId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  // Booking Modal State
  const [showBookModal, setShowBookModal] = useState(false)
  const [bookingDoctorId, setBookingDoctorId] = useState('')
  const [bookingDate, setBookingDate] = useState('')
  const [bookingTime, setBookingTime] = useState('10:00 AM')
  const [bookingType, setBookingType] = useState<'video' | 'in_person'>('video')
  const [bookingReason, setBookingReason] = useState('')
  const [bookingCaseId, setBookingCaseId] = useState('')
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [actionSuccessMessage, setActionSuccessMessage] = useState('')

  const router = useRouter()
  const searchParams = useSearchParams()

  // Open booking modal if query param ?book=true is passed
  useEffect(() => {
    if (searchParams.get('book') === 'true') {
      setShowBookModal(true)
      const linkedCase = searchParams.get('case')
      if (linkedCase) setBookingCaseId(linkedCase)
    }
  }, [searchParams])

  useEffect(() => {
    const loadData = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
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

      // 1. Resolve attending doctor from enrollment
      let attendingDocId = ''
      try {
        const { data: enrollment } = await supabase
          .from('enrollments')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (enrollment?.doctor_id) {
          attendingDocId = enrollment.doctor_id
        }
      } catch { }

      // 2. Fetch all verified doctors for selector
      const { data: docList } = await supabase
        .from('profiles')
        .select('id, full_name, specialty')
        .eq('role', 'doctor')
        .order('full_name', { ascending: true })

      if (docList && docList.length > 0) {
        setDoctors(docList)
        const primaryDoc = attendingDocId || docList[0].id
        setDefaultDoctorId(primaryDoc)
        setBookingDoctorId(primaryDoc)
      }

      // 3. Fetch patient cases for linking
      const { data: casesData } = await supabase
        .from('cases')
        .select('id, symptoms_description, created_at')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)

      if (casesData) setPatientCases(casesData)

      // 4. Fetch Appointments (Server API + Supabase)
      let combinedAppts: Appointment[] = []
      try {
        const res = await fetch(`/api/appointments?patient_id=${user.id}`)
        if (res.ok) {
          const json = await res.json()
          if (json.appointments && json.appointments.length > 0) {
            combinedAppts = json.appointments as Appointment[]
          }
        }
      } catch { }

      try {
        const { data: appts, error: apptError } = await supabase
          .from('appointments')
          .select('id, scheduled_at, status, case_id, doctor_id, type, reason')
          .eq('patient_id', user.id)
          .order('scheduled_at', { ascending: false })

        if (apptError) {
          console.warn('Supabase patient appointments query warning:', apptError.message)
        }

        if (appts && appts.length > 0) {
          appts.forEach((dbAppt) => {
            const mapped: Appointment = {
              ...dbAppt,
              cases_id: dbAppt.case_id,
            }
            if (!combinedAppts.some((a) => a.id === mapped.id)) {
              combinedAppts.push(mapped)
            }
          })
        }
      } catch (err) {
        console.warn('Supabase fetch error:', err)
      }

      // Merge with locally stored appointments if any
      try {
        const stored = localStorage.getItem(`mediq_patient_appts_${user.id}`)
        if (stored) {
          const parsed: Appointment[] = JSON.parse(stored)
          parsed.forEach((local) => {
            if (!combinedAppts.some((a) => a.id === local.id)) {
              combinedAppts.push(local)
            }
          })
        }
      } catch { }

      // Sort by scheduled_at desc
      combinedAppts.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())

      // Enrich with doctor names
      const doctorIds = [...new Set(combinedAppts.map((a) => a.doctor_id).filter(Boolean))]
      const nameMap: Record<string, { name: string; specialty: string }> = {}

      if (doctorIds.length > 0) {
        const { data: doctorProfiles } = await supabase
          .from('profiles')
          .select('id, full_name, specialty')
          .in('id', doctorIds)

        if (doctorProfiles) {
          doctorProfiles.forEach((p) => {
            nameMap[p.id] = {
              name: p.full_name || 'Attending Physician',
              specialty: p.specialty || 'General Practice',
            }
          })
        }
      }

      setAppointments(
        combinedAppts.map((a) => ({
          ...a,
          doctor_name: nameMap[a.doctor_id]?.name || 'Attending Physician',
          doctor_specialty: nameMap[a.doctor_id]?.specialty || 'General Practice',
        }))
      )

      // Default booking date = tomorrow
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      setBookingDate(tomorrow.toISOString().split('T')[0])

      setLoading(false)
    }

    loadData()
  }, [router])

  // Helper to persist appointment locally and via Supabase
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault()
    setBookingError('')

    if (!bookingDoctorId) {
      setBookingError('Please choose a doctor for this consultation.')
      return
    }

    if (!bookingDate) {
      setBookingError('Please select a date for your appointment.')
      return
    }

    setSubmittingBooking(true)

    // Build ISO timestamp
    const [hoursStr, minsAndPeriod] = bookingTime.split(':')
    const [minsStr, period] = minsAndPeriod.split(' ')
    let hours = parseInt(hoursStr, 10)
    const mins = parseInt(minsStr, 10)
    if (period === 'PM' && hours !== 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0

    const scheduledDate = new Date(bookingDate)
    scheduledDate.setHours(hours, mins, 0, 0)
    const scheduledIso = scheduledDate.toISOString()

    const chosenDoc = doctors.find((d) => d.id === bookingDoctorId)
    const tempId = crypto.randomUUID ? crypto.randomUUID() : `appt-${Date.now()}`
    const videoToken = generateVideoRoomToken()

    const newAppt: Appointment = {
      id: tempId,
      scheduled_at: scheduledIso,
      status: 'upcoming',
      type: bookingType,
      reason: bookingReason.trim() || 'General Health & Treatment Follow-up',
      cases_id: bookingCaseId || null,
      video_room_token: videoToken,
      doctor_id: bookingDoctorId,
      doctor_name: chosenDoc?.full_name ? formatDoctorName(chosenDoc.full_name) : 'Attending Physician',
      doctor_specialty: chosenDoc?.specialty || 'General Practice',
    }

    // 1. Persist to server store via API
    try {
      await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tempId,
          patient_id: userId,
          patient_name: fullName || 'Patient',
          doctor_id: bookingDoctorId,
          doctor_name: newAppt.doctor_name,
          doctor_specialty: newAppt.doctor_specialty,
          case_id: bookingCaseId || null,
          cases_id: bookingCaseId || null,
          scheduled_at: scheduledIso,
          status: 'upcoming',
          type: bookingType,
          reason: newAppt.reason,
          video_room_token: videoToken,
        }),
      })
    } catch (apiErr) {
      console.warn('API appointment persist warning:', apiErr)
    }

    // 2. Direct Supabase insert attempt
    let persistedId = tempId
    try {
      const { data: inserted, error: insertError } = await supabase
        .from('appointments')
        .insert({
          id: tempId,
          patient_id: userId,
          doctor_id: bookingDoctorId,
          case_id: bookingCaseId || null,
          scheduled_at: scheduledIso,
          status: 'upcoming',
          type: bookingType,
          reason: newAppt.reason,
          video_room_token: videoToken,
        })
        .select('id')
        .maybeSingle()

      if (!insertError && inserted?.id) {
        persistedId = inserted.id
        newAppt.id = inserted.id
      } else if (insertError) {
        if (insertError.message?.includes('row-level security')) {
          console.warn(
            'Supabase RLS notice: To enable direct browser inserts to the appointments table, run the RLS policy script in your Supabase SQL Editor. The appointment was safely persisted via the server sync API.'
          )
        } else {
          console.error('Supabase appointment insert error:', insertError.message)
        }
      }
    } catch (dbErr) {
      console.warn('Supabase appointment insert fallback notice:', dbErr)
    }

    // Save locally
    try {
      const stored = localStorage.getItem(`mediq_patient_appts_${userId}`)
      const list = stored ? JSON.parse(stored) : []
      list.unshift(newAppt)
      localStorage.setItem(`mediq_patient_appts_${userId}`, JSON.stringify(list))

      // Also persist to doctor's calendar so they see it instantly
      const docStored = localStorage.getItem(`mediq_doctor_appts_${bookingDoctorId}`)
      const docList = docStored ? JSON.parse(docStored) : []
      docList.unshift({
        ...newAppt,
        patient_id: userId,
        patient_name: fullName || 'Patient',
      })
      localStorage.setItem(`mediq_doctor_appts_${bookingDoctorId}`, JSON.stringify(docList))
    } catch { }

    // Send notification to doctor
    try {
      await sendNotification({
        userId: bookingDoctorId,
        title: 'New Telehealth Consultation Booked',
        message: `${fullName || 'A patient'} has booked a ${bookingType === 'video' ? 'video consultation' : 'clinic visit'} for ${scheduledDate.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
        type: 'appointment',
      })
    } catch { }

    setAppointments((prev) => [newAppt, ...prev])
    setSubmittingBooking(false)
    setShowBookModal(false)
    setBookingReason('')
    setActionSuccessMessage('Your consultation has been scheduled successfully!')
    setTimeout(() => setActionSuccessMessage(''), 5000)
  }

  // Handle Cancel Appointment
  const handleCancelAppointment = async (apptId: string) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return

    // 1. Update via server API
    try {
      await fetch('/api/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: apptId,
          status: 'cancelled',
        }),
      })
    } catch { }

    // 2. Update Supabase
    try {
      await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', apptId)
        .eq('patient_id', userId)
    } catch { }

    // Update local state
    setAppointments((prev) =>
      prev.map((a) => (a.id === apptId ? { ...a, status: 'cancelled' } : a))
    )

    try {
      const stored = localStorage.getItem(`mediq_patient_appts_${userId}`)
      if (stored) {
        const list: Appointment[] = JSON.parse(stored)
        const updated = list.map((a) => (a.id === apptId ? { ...a, status: 'cancelled' } : a))
        localStorage.setItem(`mediq_patient_appts_${userId}`, JSON.stringify(updated))
      }
    } catch { }

    setActionSuccessMessage('Appointment cancelled.')
    setTimeout(() => setActionSuccessMessage(''), 4000)
  }

  const upcoming = useMemo(() => appointments.filter((a) => a.status === 'upcoming'), [appointments])
  const past = useMemo(() => appointments.filter((a) => a.status !== 'upcoming'), [appointments])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-text-muted">Loading appointments...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="Appointments" />
      <TopBar />
      <DesktopHeader />

      <main className="md:ml-64 flex flex-col pb-24 md:pb-12 pt-16 md:pt-0">
        <div className="max-w-[800px] mx-auto w-full px-4 md:px-8 py-6 md:py-10 flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[24px]">calendar_month</span>
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-primary">Telehealth &amp; Appointments</h1>
                  <p className="text-xs md:text-sm text-text-muted mt-0.5">
                    Schedule live video consultations with your attending doctor or review past clinical sessions.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowBookModal(true)}
              className="bg-accent hover:bg-[#0c704d] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 self-start sm:self-center cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>Book Consultation</span>
            </button>
          </div>

          {/* Success Banner */}
          {actionSuccessMessage && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-semibold flex items-center gap-2 animate-fadeIn">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span>{actionSuccessMessage}</span>
            </div>
          )}

          {/* Telehealth Room Instructions Banner */}
          <div className="bg-white border border-border-subtle rounded-2xl p-4 md:p-5 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">videocam</span>
              </div>
              <div>
                <h4 className="text-xs font-bold text-primary">How Video Consultations Work</h4>
                <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                  Calls open automatically in our secure, encrypted video room 5 minutes before scheduled time. No downloads or passwords needed.
                </p>
              </div>
            </div>
            <Link
              href="/history"
              className="text-xs font-bold text-accent hover:underline flex items-center gap-1 shrink-0 self-start sm:self-center"
            >
              <span>View Case History</span>
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>

          {/* Main Appointment Lists */}
          {appointments.length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-2xs">
              <div className="w-16 h-16 rounded-full bg-accent/10 text-accent flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-[32px]">event_available</span>
              </div>
              <h3 className="text-base font-bold text-primary mb-1">No Consultations Scheduled Yet</h3>
              <p className="text-xs text-text-muted max-w-sm leading-relaxed mb-6">
                Need to discuss symptoms, review your medicines, or receive a live medical assessment? Schedule a video call with your doctor.
              </p>
              <button
                type="button"
                onClick={() => setShowBookModal(true)}
                className="px-5 py-2.5 bg-accent hover:bg-[#0c704d] text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>Schedule Your First Consultation</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {/* Upcoming Appointments */}
              <div>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    <span>Upcoming Consultations ({upcoming.length})</span>
                  </h2>
                </div>

                {upcoming.length === 0 ? (
                  <div className="bg-white border border-border-subtle rounded-xl p-6 text-center text-xs text-text-muted">
                    No upcoming sessions scheduled right now.{' '}
                    <button
                      type="button"
                      onClick={() => setShowBookModal(true)}
                      className="text-accent font-bold hover:underline ml-1"
                    >
                      Book a new appointment
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {upcoming.map((appt) => {
                      const jitsiUrl = getJitsiUrl(appt.id, appt.video_room_token)
                      const scheduled = new Date(appt.scheduled_at)
                      const isJoinable = Date.now() >= scheduled.getTime() - 10 * 60 * 1000 // 10m early

                      return (
                        <article
                          key={appt.id}
                          className="bg-white border-2 border-accent/40 hover:border-accent rounded-2xl p-5 md:p-6 shadow-2xs transition-all flex flex-col gap-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 rounded-xl bg-accent text-white flex items-center justify-center shrink-0 shadow-2xs">
                                <span className="material-symbols-outlined text-[24px]">videocam</span>
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-bold text-primary">Live Video Consultation</p>
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/15 text-accent">
                                    Encrypted Call
                                  </span>
                                </div>
                                <p className="text-xs text-text-muted mt-0.5">
                                  Doctor: <strong className="text-primary">{appt.doctor_name}</strong> ({appt.doctor_specialty})
                                </p>
                              </div>
                            </div>

                            <span className="text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap bg-accent/15 text-accent border border-accent/30 flex items-center gap-1.5 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
                              {timeUntil(appt.scheduled_at)}
                            </span>
                          </div>

                          {appt.reason && (
                            <div className="bg-surface-secondary/70 rounded-xl p-3 border border-border-subtle text-xs">
                              <span className="font-bold text-text-muted uppercase tracking-wider text-[10px] block mb-0.5">
                                Agenda / Discussion Reason
                              </span>
                              <p className="text-primary leading-relaxed">{appt.reason}</p>
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-xs text-primary bg-surface-secondary/80 rounded-xl px-3.5 py-2.5 border border-border-subtle">
                            <span className="material-symbols-outlined text-[18px] text-accent">event_available</span>
                            <span className="font-semibold">
                              {scheduled.toLocaleString([], {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-3 pt-2">
                            <a
                              href={jitsiUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`flex-1 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${isJoinable
                                  ? 'bg-accent hover:bg-[#0c704d] text-white'
                                  : 'bg-accent/80 hover:bg-accent text-white'
                                }`}
                            >
                              <span className="material-symbols-outlined text-[18px]">videocam</span>
                              <span>{isJoinable ? 'Join Video Room Now' : 'Enter Consultation Room'}</span>
                            </a>

                            <button
                              type="button"
                              onClick={() => handleCancelAppointment(appt.id)}
                              className="px-4 py-3 rounded-xl font-semibold text-xs border border-border-subtle text-text-muted hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[16px]">close</span>
                              <span>Cancel</span>
                            </button>
                          </div>

                          {appt.cases_id && (
                            <div className="pt-2 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-muted">
                              <Link
                                href={`/cases/${appt.cases_id}`}
                                className="text-accent hover:underline flex items-center gap-1 font-semibold"
                              >
                                <span className="material-symbols-outlined text-[14px]">description</span>
                                <span>View Linked Case Discussion</span>
                              </Link>
                              <span className="font-mono">Ref: #{appt.id.slice(0, 8).toUpperCase()}</span>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Past Consultations */}
              {past.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 px-1">
                    Past &amp; Completed Consultations ({past.length})
                  </h2>

                  <div className="flex flex-col gap-3">
                    {past.map((appt) => {
                      const style = statusStyles[appt.status] ?? statusStyles.completed
                      return (
                        <article
                          key={appt.id}
                          className="bg-white border border-border-subtle rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-surface-secondary flex items-center justify-center shrink-0 text-text-muted">
                              <span className="material-symbols-outlined text-[20px]">videocam</span>
                            </div>
                            <div>
                              <p className="text-xs font-bold text-primary">Telehealth Consultation</p>
                              <p className="text-[11px] text-text-muted">
                                with {appt.doctor_name || 'Attending Physician'} ({appt.doctor_specialty})
                              </p>
                              <p className="text-[10px] text-text-muted mt-0.5">
                                {new Date(appt.scheduled_at).toLocaleString([], {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize border ${style.badge}`}>
                              {style.label}
                            </span>
                            {appt.cases_id && (
                              <Link
                                href={`/cases/${appt.cases_id}`}
                                className="text-xs text-accent font-semibold hover:underline"
                              >
                                View Case
                              </Link>
                            )}
                          </div>
                        </article>
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

      {/* ── Book Consultation Modal ─────────────────────────── */}
      {showBookModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-border-subtle my-8 animate-fadeIn">
            <div className="flex items-center justify-between pb-4 border-b border-border-subtle mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[22px]">calendar_add_on</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-primary">Book Doctor Consultation</h3>
                  <p className="text-xs text-text-muted">Choose your preferred date, time slot, and agenda.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBookModal(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-secondary text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {bookingError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{bookingError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAppointment} className="space-y-4 text-xs">
              {/* Consultation Type Selector */}
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
                  Consultation Format
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBookingType('video')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${bookingType === 'video'
                        ? 'border-accent bg-accent/10 text-accent font-bold shadow-2xs'
                        : 'border-border-subtle text-text-muted hover:border-accent/40'
                      }`}
                  >
                    <span className="material-symbols-outlined text-[24px]">videocam</span>
                    <span className="text-xs">Live Video Call</span>
                    <span className="text-[10px] text-text-muted">Encrypted Web Room</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBookingType('in_person')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${bookingType === 'in_person'
                        ? 'border-accent bg-accent/10 text-accent font-bold shadow-2xs'
                        : 'border-border-subtle text-text-muted hover:border-accent/40'
                      }`}
                  >
                    <span className="material-symbols-outlined text-[24px]">local_hospital</span>
                    <span className="text-xs">In-Clinic Visit</span>
                    <span className="text-[10px] text-text-muted">Hospital Appointment</span>
                  </button>
                </div>
              </div>

              {/* Select Attending Physician */}
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  Select Attending Doctor
                </label>
                <select
                  value={bookingDoctorId}
                  onChange={(e) => setBookingDoctorId(e.target.value)}
                  className="w-full bg-surface-secondary border border-border-subtle rounded-xl px-3.5 py-2.5 text-xs text-primary font-medium focus:outline-none focus:border-accent"
                >
                  {doctors.length === 0 ? (
                    <option value="">Attending Hospital Physician</option>
                  ) : (
                    doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {formatDoctorName(d.full_name)} ({d.specialty || 'General Practice'})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Date & Time Slot */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Preferred Date
                  </label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={bookingDate}
                    onChange={(e) => setBookingDate(e.target.value)}
                    required
                    className="w-full bg-surface-secondary border border-border-subtle rounded-xl px-3.5 py-2.5 text-xs text-primary font-medium focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Preferred Time Slot
                  </label>
                  <select
                    value={bookingTime}
                    onChange={(e) => setBookingTime(e.target.value)}
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

              {/* Reason / Symptoms */}
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  Reason for Consultation / Health Concern
                </label>
                <textarea
                  rows={3}
                  value={bookingReason}
                  onChange={(e) => setBookingReason(e.target.value)}
                  placeholder="e.g. Follow-up on blood pressure medicines, discussing mild nausea, or reviewing recent lab results..."
                  className="w-full bg-surface-secondary border border-border-subtle rounded-xl p-3 text-xs text-primary placeholder:text-text-muted focus:outline-none focus:border-accent leading-relaxed"
                />
              </div>

              {/* Optional Case Link */}
              {patientCases.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Link to an Existing Medical Case (Optional)
                  </label>
                  <select
                    value={bookingCaseId}
                    onChange={(e) => setBookingCaseId(e.target.value)}
                    className="w-full bg-surface-secondary border border-border-subtle rounded-xl px-3.5 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="">-- No specific case / General Consultation --</option>
                    {patientCases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.symptoms_description.slice(0, 50)}... ({new Date(c.created_at).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-border-subtle flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowBookModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:text-primary hover:bg-surface-secondary text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingBooking}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-[#0c704d] text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingBooking ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Scheduling...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">check</span>
                      <span>Confirm &amp; Book</span>
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

export default function AppointmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <AppointmentsContent />
    </Suspense>
  )
}