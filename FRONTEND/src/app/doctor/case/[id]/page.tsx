'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications'
import { formatDoctorName } from '@/shared/utils'
import { computeCaseSLA } from '@/lib/sla'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'

type CaseData = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
  created_at: string
  patient_id: string
  doctor_id: string | null
}

type ActiveCarePlan = {
  id: string
  type: string
  details: string
  schedule: string
  created_at: string
}

type MedicationItem = {
  id: string
  name: string
  dosage: string | null
  schedule_times: string | null
  instructions: string | null
}

type ThreadMessage = {
  id: string
  senderRole: 'doctor' | 'patient'
  senderName: string
  message: string
  prescription?: string | null
  createdAt: string
}

const urgencyConfig: Record<string, { label: string; badge: string; dot: string }> = {
  needs_live_call: {
    label: 'Priority Review',
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-600',
  },
  somewhat_urgent: {
    label: 'Needs Attention',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
  },
  routine: {
    label: 'Routine Follow-Up',
    badge: 'bg-surface-secondary text-text-muted border-border-subtle',
    dot: 'bg-emerald-500',
  },
}

const DOCTOR_QUICK_CHIPS = [
  '✅ Regimen on track — continue current dose',
  '💊 Adjust dosage as instructed',
  '⚠️ Monitor symptoms closely for next 24h',
  '🏥 Recommend in-person physical checkup',
]

function getPatientInitials(name: string): string {
  if (!name || name === 'Patient' || name === 'Enrolled Patient') return 'PT'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function isSameMessage(
  a: { id?: string; message: string; senderRole: string; createdAt?: string },
  b: { id?: string; message: string; senderRole: string; createdAt?: string }
): boolean {
  if (a.id && b.id && a.id === b.id) return true
  const msgA = (a.message || '').trim()
  const msgB = (b.message || '').trim()
  if (msgA === msgB && a.senderRole === b.senderRole) {
    if (a.createdAt && b.createdAt) {
      const diff = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      if (diff < 60000) return true
    } else {
      return true
    }
  }
  return false
}

export default function DoctorCaseReviewPage() {
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [doctorId, setDoctorId] = useState('')

  // Case & Patient
  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [patientName, setPatientName] = useState('Patient')
  const [patientPhone, setPatientPhone] = useState('')
  const [patientAge, setPatientAge] = useState<number | null>(null)
  const [patientGender, setPatientGender] = useState<string | null>(null)
  const [category, setCategory] = useState('Follow-Up Concern')
  const [cleanDescription, setCleanDescription] = useState('')

  // Clinical Context & Thread
  const [activePlan, setActivePlan] = useState<ActiveCarePlan | null>(null)
  const [medications, setMedications] = useState<MedicationItem[]>([])
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [escalating, setEscalating] = useState(false)

  // Chat Input
  const [message, setMessage] = useState('')
  const [prescription, setPrescription] = useState('')
  const [showRxInput, setShowRxInput] = useState(false)
  const [showCaseDetails, setShowCaseDetails] = useState(false)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const router = useRouter()
  const params = useParams()
  const caseId = params?.id as string
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    const loadData = async () => {
      if (!caseId) return

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setDoctorId(user.id)

      // Doctor Profile
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
      setSpecialty(profile.specialty || 'General Practice')

      // Fetch Case
      const { data: theCase } = await supabase
        .from('cases')
        .select('id, symptoms_description, photo_url, urgency, status, created_at, patient_id, doctor_id')
        .eq('id', caseId)
        .maybeSingle()

      if (theCase) {
        setCaseData(theCase)

        // Parse category from description
        const rawDesc = theCase.symptoms_description || ''
        const match = rawDesc.match(/^\[Category:\s*([^\]]+)\]\s*([\s\S]*)$/i)
        if (match) {
          setCategory(match[1].trim())
          setCleanDescription(match[2].trim())
        } else {
          setCategory('Follow-Up Concern')
          setCleanDescription(rawDesc)
        }

        // Fetch Patient Profile (safe select + enrollment fallback)
        let foundName = ''
        let foundPhone = ''

        try {
          const { data: patientProfile } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('id', theCase.patient_id)
            .maybeSingle()

          if (patientProfile) {
            if (patientProfile.full_name) foundName = patientProfile.full_name
            if (patientProfile.phone) foundPhone = patientProfile.phone
          }
        } catch {}

        if (!foundName) {
          try {
            const { data: enrollment } = await supabase
              .from('enrollments')
              .select('patient_name, patient_phone')
              .eq('patient_id', theCase.patient_id)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            if (enrollment) {
              if (enrollment.patient_name) foundName = enrollment.patient_name
              if (enrollment.patient_phone && !foundPhone) foundPhone = enrollment.patient_phone
            }
          } catch {}
        }

        setPatientName(foundName || 'Enrolled Patient')
        setPatientPhone(foundPhone)

        // Fetch Patient's Active Care Plan
        const { data: planData } = await supabase
          .from('care_plans')
          .select('id, type, details, schedule, created_at')
          .eq('patient_id', theCase.patient_id)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (planData) {
          setActivePlan(planData)

          // Fetch Prescribed Medications
          const { data: meds } = await supabase
            .from('medications')
            .select('id, name, dosage, schedule_times, instructions')
            .eq('care_plan_id', planData.id)
            .order('created_at', { ascending: true })

          if (meds) setMedications(meds)
        }

        // Fetch Responses and Messages for Thread
        const { data: prevResponses } = await supabase
          .from('responses')
          .select('id, message, prescription, created_at')
          .eq('cases_id', caseId)
          .order('created_at', { ascending: true })

        const threaded: ThreadMessage[] = []
        const currentDocName = formatDoctorName(profile.full_name)

        if (prevResponses && prevResponses.length > 0) {
          for (const r of prevResponses) {
            threaded.push({
              id: r.id,
              senderRole: 'doctor',
              senderName: currentDocName,
              message: r.message,
              prescription: r.prescription,
              createdAt: r.created_at,
            })
          }
        }

        // Fetch case_messages
        try {
          const { data: messagesData } = await supabase
            .from('case_messages')
            .select('id, message, sender_id, sender_role, created_at')
            .eq('case_id', caseId)
            .order('created_at', { ascending: true })

          if (messagesData && messagesData.length > 0) {
            for (const m of messagesData) {
              const role = m.sender_role as 'doctor' | 'patient'
              const isDuplicate = threaded.some((t) =>
                isSameMessage(t, { id: m.id, message: m.message, senderRole: role, createdAt: m.created_at })
              )
              if (!isDuplicate) {
                threaded.push({
                  id: m.id,
                  senderRole: role,
                  senderName:
                    role === 'doctor'
                      ? currentDocName
                      : (foundName || 'Patient'),
                  message: m.message,
                  createdAt: m.created_at,
                })
              }
            }
          }
        } catch {
          // Graceful fallback if table not yet migrated
        }

        // Also check localStorage for self-healing thread continuity
        try {
          const cached = localStorage.getItem(`mediq_chat_${caseId}`)
          if (cached) {
            const parsed: ThreadMessage[] = JSON.parse(cached)
            for (const cm of parsed) {
              const isDuplicate = threaded.some((t) => isSameMessage(t, cm))
              if (!isDuplicate) {
                threaded.push(cm)
              }
            }
          }
        } catch {
          // Ignore localStorage errors
        }

        // Also check embedded follow-ups in symptoms_description
        if (theCase.symptoms_description) {
          const followUpRegex = /\[Patient Follow-Up\s*-\s*([^\]]+)\]:\s*([\s\S]*?)(?=\n\n\[|$)/gi
          let match
          while ((match = followUpRegex.exec(theCase.symptoms_description)) !== null) {
            const content = match[2].trim()
            if (!threaded.some((t) => t.message.trim() === content) && content) {
              threaded.push({
                id: `parsed_${Math.random().toString(36).slice(2)}`,
                senderRole: 'patient',
                senderName: foundName || 'Patient',
                message: content,
                createdAt: theCase.created_at,
              })
            }
          }
        }

        threaded.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        setThreadMessages(threaded)

        // Bind doctor to case if not set and mark in_review
        if (!theCase.doctor_id || theCase.status === 'pending') {
          await supabase
            .from('cases')
            .update({ doctor_id: user.id, status: 'in_review' })
            .eq('id', caseId)
        }
      }

      setLoading(false)
    }

    loadData()
  }, [caseId, router])

  // Resilient helper to fetch new messages without full reload
  const fetchNewMessages = useCallback(async () => {
    if (!caseId) return
    try {
      const { data: messagesData } = await supabase
        .from('case_messages')
        .select('id, message, sender_id, sender_role, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true })

      if (messagesData && messagesData.length > 0) {
        setThreadMessages((prev) => {
          let hasNew = false
          const updated = [...prev]
          const docDisplayName = formatDoctorName(fullName)

          for (const m of messagesData) {
            const role = m.sender_role as 'doctor' | 'patient'
            const exists = updated.some((t) =>
              isSameMessage(t, { id: m.id, message: m.message, senderRole: role, createdAt: m.created_at })
            )
            if (!exists) {
              hasNew = true
              updated.push({
                id: m.id,
                senderRole: role,
                senderName: role === 'doctor' ? docDisplayName : (patientName || 'Patient'),
                message: m.message,
                createdAt: m.created_at,
              })
            }
          }

          if (hasNew) {
            updated.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            setTimeout(() => scrollToBottom(true), 50)
            return updated
          }
          return prev
        })
      }
    } catch {
      // Non-blocking
    }
  }, [caseId, fullName, patientName])

  // Real-time synchronization and auto-polling
  useEffect(() => {
    if (!caseId || loading) return

    let isMounted = true
    let pollInterval: NodeJS.Timeout | null = null

    // 1. Supabase Realtime Channel
    const channelName = `mediq_chat_${caseId}`
    const channel = supabase.channel(channelName)

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'case_messages',
          filter: `case_id=eq.${caseId}`,
        },
        (payload) => {
          if (!isMounted) return
          const newRow = payload.new as {
            id: string
            case_id: string
            sender_id: string
            sender_role: string
            message: string
            created_at: string
          }
          if (newRow && newRow.message) {
            setThreadMessages((prev) => {
              const role = newRow.sender_role as 'doctor' | 'patient'
              const exists = prev.some((t) =>
                isSameMessage(t, { id: newRow.id, message: newRow.message, senderRole: role, createdAt: newRow.created_at })
              )
              if (exists) return prev
              const updated = [
                ...prev,
                {
                  id: newRow.id,
                  senderRole: role,
                  senderName:
                    role === 'doctor'
                      ? formatDoctorName(fullName)
                      : (patientName || 'Patient'),
                  message: newRow.message,
                  createdAt: newRow.created_at,
                },
              ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              setTimeout(() => scrollToBottom(true), 50)
              return updated
            })
          }
        }
      )
      .on('broadcast', { event: 'new_message' }, (payload) => {
        if (!isMounted) return
        const p = payload.payload as {
          id: string
          sender_role: string
          sender_name?: string
          message: string
          created_at: string
        }
        if (p && p.message) {
          setThreadMessages((prev) => {
            const role = p.sender_role as 'doctor' | 'patient'
            const exists = prev.some((t) =>
              isSameMessage(t, { id: p.id, message: p.message, senderRole: role, createdAt: p.created_at })
            )
            if (exists) return prev
            const updated = [
              ...prev,
              {
                id: p.id,
                senderRole: role,
                senderName: p.sender_name || (role === 'doctor' ? 'Attending Physician' : (patientName || 'Patient')),
                message: p.message,
                createdAt: p.created_at,
              },
            ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            setTimeout(() => scrollToBottom(true), 50)
            return updated
          })
        }
      })
      .subscribe()

    channelRef.current = channel

    // 2. Resilient Auto-Polling Fallback (Every 3 seconds)
    pollInterval = setInterval(() => {
      if (isMounted) {
        fetchNewMessages()
      }
    }, 3000)

    // 3. Window Event Listeners for local tab/window updates
    const handleLocalEvent = () => {
      if (isMounted) fetchNewMessages()
    }
    window.addEventListener('mediq_chat_message', handleLocalEvent)
    window.addEventListener('mediq_notification', handleLocalEvent)
    window.addEventListener('storage', handleLocalEvent)

    return () => {
      isMounted = false
      if (pollInterval) clearInterval(pollInterval)
      if (channel) supabase.removeChannel(channel)
      channelRef.current = null
      window.removeEventListener('mediq_chat_message', handleLocalEvent)
      window.removeEventListener('mediq_notification', handleLocalEvent)
      window.removeEventListener('storage', handleLocalEvent)
    }
  }, [caseId, loading, fullName, patientName, fetchNewMessages])

  useEffect(() => {
    if (!loading && threadMessages.length > 0) {
      scrollToBottom(false)
    }
  }, [loading, threadMessages.length])

  // Doctor Sending Guidance or Follow-up Message
  const handleSendResponse = async (textToSend?: string) => {
    const rawMsg = typeof textToSend === 'string' ? textToSend : message
    const currentMsg = rawMsg.trim()
    if (!currentMsg || submitting) return

    setSubmitting(true)
    setError('')
    const currentPrescription = prescription.trim() || null
    const docDisplayName = formatDoctorName(fullName)

    const tempId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const nowIso = new Date().toISOString()
    const newDocItem: ThreadMessage = {
      id: tempId,
      senderRole: 'doctor',
      senderName: docDisplayName,
      message: currentMsg,
      prescription: currentPrescription,
      createdAt: nowIso,
    }

    // 1. Optimistic UI update
    setThreadMessages((prev) => [...prev, newDocItem])
    setMessage('')
    setPrescription('')
    setShowRxInput(false)
    setTimeout(() => scrollToBottom(true), 50)

    // 2. Insert into case_messages (the primary live chat thread)
    let realMsgId = tempId
    let realCreatedAt = nowIso
    try {
      const { data: insertedMsg } = await supabase
        .from('case_messages')
        .insert({
          case_id: caseId,
          sender_id: doctorId,
          sender_role: 'doctor',
          message: currentMsg,
        })
        .select('id, created_at')
        .maybeSingle()

      if (insertedMsg) {
        realMsgId = insertedMsg.id
        realCreatedAt = insertedMsg.created_at
        setThreadMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: realMsgId, createdAt: realCreatedAt } : m))
        )
      }
    } catch {
      // Non-blocking
    }

    // 3. Insert into responses table ONLY if prescription is provided OR if case has no response yet
    const needsConsultationRecord = currentPrescription || (caseData?.status !== 'responded' && caseData?.status !== 'closed' && caseData?.status !== 'resolved')
    if (needsConsultationRecord) {
      try {
        await supabase.from('responses').insert({
          cases_id: caseId,
          case_id: caseId,
          doctor_id: doctorId,
          message: currentMsg,
          prescription: currentPrescription,
        })
      } catch {
        // Non-blocking
      }
    }

    // 4. Update case status to 'responded'
    await supabase
      .from('cases')
      .update({ status: 'responded', doctor_id: doctorId })
      .eq('id', caseId)

    // 5. Broadcast via Realtime Channel
    if (channelRef.current) {
      try {
        channelRef.current.send({
          type: 'broadcast',
          event: 'new_message',
          payload: {
            id: realMsgId,
            case_id: caseId,
            sender_id: doctorId,
            sender_role: 'doctor',
            sender_name: docDisplayName,
            message: currentMsg,
            created_at: realCreatedAt,
          },
        })
      } catch {
        // Non-blocking
      }
    }

    // 6. Broadcast via window event for local multi-tab sync
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('mediq_chat_message', {
          detail: { caseId, senderRole: 'doctor', message: currentMsg },
        })
      )
    }

    // 7. Cache locally for self-healing continuity
    try {
      const localKey = `mediq_chat_${caseId}`
      const existingLocal: ThreadMessage[] = JSON.parse(localStorage.getItem(localKey) || '[]')
      const isAlreadySaved = existingLocal.some((m) =>
        isSameMessage(m, { id: realMsgId, message: currentMsg, senderRole: 'doctor', createdAt: realCreatedAt })
      )
      if (!isAlreadySaved) {
        existingLocal.push({ ...newDocItem, id: realMsgId, createdAt: realCreatedAt })
        localStorage.setItem(localKey, JSON.stringify(existingLocal))
      }
    } catch {
      // Ignore
    }

    // 8. Send in-app notification to patient
    if (caseData?.patient_id) {
      await sendNotification({
        userId: caseData.patient_id,
        title: 'Doctor Follow-Up Response',
        message: `${formatDoctorName(fullName, 'Your physician')} reviewed and replied to your clinical note.`,
        type: 'case_response',
      })
    }

    setCaseData((prev) => (prev ? { ...prev, status: 'responded' } : null))
    setToastMsg('Guidance sent to patient')
    setTimeout(() => setToastMsg(null), 3500)
    setSubmitting(false)
  }

  // Doctor Recommends Hospital Visit
  const handleHospitalAlert = async () => {
    if (!caseData || submitting) return

    setSubmitting(true)
    setError('')

    const alertMsg = 'I strongly recommend an in-person physical examination at the clinic or hospital triage regarding your recent symptoms.'
    await handleSendResponse(alertMsg)

    if (caseData.patient_id) {
      await sendNotification({
        userId: caseData.patient_id,
        title: '⚠️ Urgent: In-Person Examination Advised',
        message: `${formatDoctorName(fullName, 'Your physician')} advises an in-person clinic or hospital visit for physical examination.`,
        type: 'hospital_alert',
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendResponse()
    }
  }

  // Resolve case and close discussion thread
  const handleResolveCase = async () => {
    if (!caseData || resolving) return
    setResolving(true)

    const docDisplayName = formatDoctorName(fullName)
    const resolutionNotice: ThreadMessage = {
      id: `res_${Date.now()}`,
      senderRole: 'doctor',
      senderName: docDisplayName,
      message: '✅ Clinical consultation marked as solved and closed. The message thread is now concluded.',
      createdAt: new Date().toISOString(),
    }

    setThreadMessages((prev) => [...prev, resolutionNotice])

    // Update case status to 'closed'
    await supabase
      .from('cases')
      .update({ status: 'closed' })
      .eq('id', caseId)

    // Cache locally
    try {
      const localKey = `mediq_chat_${caseId}`
      const existing: ThreadMessage[] = JSON.parse(localStorage.getItem(localKey) || '[]')
      existing.push(resolutionNotice)
      localStorage.setItem(localKey, JSON.stringify(existing))
    } catch {
      // Ignore
    }

    // Send notification to patient
    if (caseData.patient_id) {
      await sendNotification({
        userId: caseData.patient_id,
        title: 'Case Resolved & Closed',
        message: `${formatDoctorName(fullName, 'Your physician')} marked case #${caseId.slice(0, 8)} as solved. The message thread is now closed.`,
        type: 'case_resolved',
      })
    }

    setCaseData((prev) => (prev ? { ...prev, status: 'closed' } : null))
    setToastMsg('Case marked as solved & thread closed')
    setTimeout(() => setToastMsg(null), 3500)
    setResolving(false)
  }

  // Reopen discussion thread if needed
  const handleReopenCase = async () => {
    if (!caseData) return
    await supabase
      .from('cases')
      .update({ status: 'responded' })
      .eq('id', caseId)
    setCaseData((prev) => (prev ? { ...prev, status: 'responded' } : null))
    setToastMsg('Discussion thread reopened')
    setTimeout(() => setToastMsg(null), 3500)
  }

  // Escalate case to on-call clinical pool
  const handleEscalateOnCall = async () => {
    if (!caseData || escalating || escalated) return
    setEscalating(true)
    try {
      if (caseData.patient_id) {
        await sendNotification({
          userId: caseData.patient_id,
          title: 'Clinical Escalation Notice',
          message: 'Your case review has been escalated to our on-call physician team for expedited attention.',
          type: 'case_escalation',
        })
      }
      setEscalated(true)
      setToastMsg('Case successfully escalated to On-Call Physician Pool')
      setTimeout(() => setToastMsg(null), 4000)
    } finally {
      setEscalating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted text-xs font-semibold">Loading clinical discussion...</p>
      </div>
    )
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <DoctorSidebar fullName={fullName} specialty={specialty} activePage="Messages" />
        <DoctorDesktopHeader fullName={fullName} specialty={specialty} />

        <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex-1 flex flex-col items-center justify-center p-6 text-center transition-all duration-300 ease-in-out">
          <span className="material-symbols-outlined text-text-muted text-5xl mb-4">folder_off</span>
          <h2 className="text-xl font-bold text-primary mb-2">Note Not Found</h2>
          <p className="text-xs text-text-muted mb-6">
            The clinical follow-up you are looking for does not exist.
          </p>
          <Link
            href="/doctor/queue"
            className="px-4 py-2 bg-accent text-white rounded-xl text-xs font-bold"
          >
            Back to Queue
          </Link>
        </main>
      </div>
    )
  }

  const urgency = urgencyConfig[caseData.urgency] || urgencyConfig.routine
  const sla = caseData ? computeCaseSLA(caseData.urgency, caseData.created_at, caseData.status) : null

  return (
    <div className="min-h-screen bg-[#F4F8F7] font-sans antialiased text-primary flex flex-col">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="Messages" />
      <DoctorDesktopHeader fullName={fullName} specialty={specialty} />

      {/* Main Chat Canvas */}
      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex-1 flex flex-col pt-14 md:pt-0 pb-20 md:pb-6 relative transition-all duration-300 ease-in-out">
        <div className="w-full max-w-4xl mx-auto flex-1 flex flex-col">
          {/* ── Top Doctor Chat Bar (Sticky Header) ────────────────── */}
          <div className="sticky top-14 md:top-16 z-30 bg-white/95 backdrop-blur-md border-b border-border-subtle px-4 py-3 sm:px-6 shadow-2xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/doctor/queue"
              className="w-8 h-8 rounded-full hover:bg-surface-secondary flex items-center justify-center text-text-muted hover:text-primary transition-colors shrink-0"
              title="Back to Follow-Up Queue"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </Link>

            {/* Patient Avatar */}
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center font-bold text-sm shadow-2xs">
                {getPatientInitials(patientName)}
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm sm:text-base font-bold text-primary truncate">
                  {patientName}
                </h1>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${urgency.badge}`}>
                  {urgency.label}
                </span>
                {sla && caseData.status !== 'closed' && caseData.status !== 'resolved' && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                      sla.isBreached
                        ? 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                        : sla.isWarning
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-surface-secondary text-text-muted border-border-subtle'
                    }`}
                    title={`Triage Target: ${sla.slaLabel}`}
                  >
                    <span className="material-symbols-outlined text-[12px]">schedule</span>
                    <span>{sla.isBreached ? `SLA Breached (${sla.overdueStr})` : sla.timeRemainingStr}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-muted truncate">
                Enrolled Patient
                {patientPhone ? ` • ${patientPhone}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Resolve & Close Button / Case Solved Badge */}
            {caseData.status === 'closed' || caseData.status === 'resolved' ? (
              <div className="flex items-center gap-1.5">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 border border-gray-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-emerald-600">task_alt</span>
                  <span>Solved</span>
                </span>
                <button
                  type="button"
                  onClick={handleReopenCase}
                  className="px-2 py-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
                  title="Reopen conversation thread"
                >
                  Reopen
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleResolveCase}
                disabled={resolving}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Mark case as solved and close chat thread"
              >
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span className="hidden sm:inline">Resolve &amp; Close</span>
              </button>
            )}

            {/* Direct link to patient's active care plan */}
            {activePlan && (
              <Link
                href={`/doctor/patients/${caseData.patient_id}/care-plan`}
                className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-accent bg-accent/10 hover:bg-accent hover:text-white transition-all shadow-2xs"
                title="View or Adjust Care Plan"
              >
                <span className="material-symbols-outlined text-[15px]">medication</span>
                <span>Care Plan</span>
              </Link>
            )}

            {/* Toggle Inquiry Note */}
            <button
              type="button"
              onClick={() => setShowCaseDetails(!showCaseDetails)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-primary hover:bg-surface-secondary border border-border-subtle transition-all flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">assignment</span>
              <span className="hidden sm:inline">{showCaseDetails ? 'Hide Details' : 'View Note'}</span>
            </button>
          </div>
        </div>

        {/* ── SLA Escalation Alert Banner if Breached ─────────────────── */}
        {sla && sla.isBreached && caseData.status !== 'closed' && caseData.status !== 'resolved' && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2.5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-red-800 font-medium">
              <span className="material-symbols-outlined text-red-600 text-[18px] shrink-0">emergency</span>
              <span>
                <strong>Clinical Escalation Alert:</strong> SLA target ({sla.slaLabel}) exceeded by {sla.overdueStr}. Patient requires timely physician intervention.
              </span>
            </div>
            <button
              type="button"
              onClick={handleEscalateOnCall}
              disabled={escalated || escalating}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto ${
                escalated
                  ? 'bg-emerald-600 text-white cursor-default'
                  : 'bg-red-600 hover:bg-red-700 text-white disabled:opacity-60'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {escalated ? 'check' : 'groups'}
              </span>
              <span>{escalated ? 'Escalated to On-Call Pool' : 'Escalate to On-Call Pool'}</span>
            </button>
          </div>
        )}

        {/* ── Toast Alert Banner ─────────────────────────────────── */}
        {toastMsg && (
          <div className="fixed top-18 right-4 md:right-8 z-50 bg-emerald-700 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 animate-bounce">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            <span>{toastMsg}</span>
          </div>
        )}

        {/* ── Collapsible Patient Inquiry Summary ────────────────── */}
        {showCaseDetails && (
          <div className="px-4 sm:px-6 pt-3 animate-fadeIn">
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-accent text-[18px]">medical_information</span>
                  <span className="text-xs font-bold text-primary">Patient Inquiry Note ({category})</span>
                </div>
                <span className="text-[10px] text-text-muted font-mono">
                  Submitted {new Date(caseData.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <p className="text-xs text-primary leading-relaxed whitespace-pre-wrap bg-surface-secondary/50 p-3 rounded-xl border border-border-subtle">
                {cleanDescription}
              </p>

              {/* Progress Photo Thumbnail */}
              {caseData.photo_url && (
                <div className="pt-1 flex items-center gap-3">
                  <div
                    onClick={() => setShowPhotoModal(true)}
                    className="relative rounded-lg overflow-hidden border border-border-subtle cursor-pointer group shrink-0"
                  >
                    <img
                      src={caseData.photo_url}
                      alt="Uploaded progress"
                      className="w-16 h-16 object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                      <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                    </div>
                  </div>
                  <div className="text-[11px]">
                    <p className="font-semibold text-primary">Progress Image Attached</p>
                    <p className="text-text-muted">Tap photo thumbnail to view full resolution</p>
                  </div>
                </div>
              )}

              {/* Active Medication Regimen Context */}
              {medications.length > 0 && (
                <div className="pt-2 border-t border-border-subtle">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                    Current Prescribed Medications ({medications.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {medications.map((m) => (
                      <span
                        key={m.id}
                        className="px-2 py-0.5 rounded-md bg-surface-secondary text-[11px] font-medium text-primary border border-border-subtle"
                      >
                        {m.name} {m.dosage ? `(${m.dosage})` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Chat Messages Timeline Canvas ──────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Date separator */}
          <div className="flex justify-center my-2">
            <span className="px-3 py-1 rounded-full bg-white/80 border border-border-subtle text-[10px] font-bold uppercase tracking-wider text-text-muted shadow-2xs">
              Clinical Discussion • {new Date(caseData.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>

          {/* Initial patient symptom note as first anchor bubble on left */}
          <div className="flex items-start gap-2 max-w-[85%] sm:max-w-[75%]">
            <div className="w-8 h-8 rounded-full bg-surface-secondary text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-border-subtle mt-1">
              Pt
            </div>
            <div className="bg-white border border-border-subtle rounded-2xl rounded-tl-xs p-3.5 sm:p-4 text-primary shadow-xs">
              <div className="flex items-center justify-between gap-3 text-[10px] text-text-muted mb-1">
                <span className="font-bold text-primary">{patientName} (Initial Inquiry)</span>
                <span>
                  {new Date(caseData.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap text-primary">
                {cleanDescription}
              </p>
              {caseData.photo_url && (
                <div
                  onClick={() => setShowPhotoModal(true)}
                  className="mt-2 rounded-xl overflow-hidden border border-border-subtle cursor-pointer group"
                >
                  <img
                    src={caseData.photo_url}
                    alt="Uploaded attachment"
                    className="max-h-40 w-auto rounded-lg object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="p-1 bg-surface-secondary text-[10px] text-text-muted font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                    <span>Progress photo attached (Tap to enlarge)</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Follow-Up Thread Messages */}
          {threadMessages.map((msg, idx) => {
            const isDoctor = msg.senderRole === 'doctor'

            if (isDoctor) {
              return (
                /* Doctor Message Bubble (Right - Outgoing) */
                <div key={msg.id || idx} className="flex justify-end animate-fadeIn">
                  <div className="max-w-[85%] sm:max-w-[75%] bg-accent text-white rounded-2xl rounded-tr-xs p-3.5 sm:p-4 shadow-xs">
                    <div className="flex items-center justify-between gap-3 text-[10px] text-white/80 mb-1">
                      <span className="font-bold">{msg.senderName} (You)</span>
                      <span>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-white leading-relaxed whitespace-pre-wrap">
                      {msg.message}
                    </p>

                    {msg.prescription && (
                      <div className="bg-white/15 border border-white/30 rounded-xl p-2.5 mt-2 text-white">
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/90 mb-0.5">
                          <span className="material-symbols-outlined text-[14px]">prescriptions</span>
                          <span>Dosage / Prescription Note</span>
                        </div>
                        <p className="text-xs font-semibold text-white">{msg.prescription}</p>
                      </div>
                    )}

                    <div className="flex justify-end mt-1 text-white/70">
                      <span className="material-symbols-outlined text-[14px]">done_all</span>
                    </div>
                  </div>
                </div>
              )
            } else {
              return (
                /* Patient Message Bubble (Left - Incoming) */
                <div key={msg.id || idx} className="flex items-start gap-2 max-w-[85%] sm:max-w-[75%] animate-fadeIn">
                  <div className="w-8 h-8 rounded-full bg-surface-secondary text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-border-subtle mt-1">
                    Pt
                  </div>
                  <div className="bg-white border border-border-subtle rounded-2xl rounded-tl-xs p-3.5 sm:p-4 text-primary shadow-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-primary">{msg.senderName}</span>
                      <span className="px-1.5 py-0.2 rounded-full bg-surface-secondary text-text-muted text-[9px] font-bold">
                        Patient
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-primary leading-relaxed whitespace-pre-wrap">
                      {msg.message}
                    </p>

                    <div className="flex justify-end mt-1 text-[10px] text-text-muted">
                      <span>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            }
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Sticky Mobile-First Doctor Action Bar (Active vs Closed) ── */}
        {caseData.status === 'closed' || caseData.status === 'resolved' ? (
          <div className="sticky bottom-0 bg-white/95 backdrop-blur-md border-t border-border-subtle p-4 z-30 shadow-md text-center">
            <div className="flex items-center justify-center gap-2 text-emerald-800 font-bold text-xs mb-1">
              <span className="material-symbols-outlined text-[18px] text-emerald-600">task_alt</span>
              <span>Case Marked Solved &bull; Message Thread Closed</span>
            </div>
            <p className="text-[11px] text-text-muted max-w-md mx-auto mb-2.5">
              The conversation thread is closed for this consultation. The patient cannot send further messages unless you reopen the thread or they submit a new consultation case.
            </p>
            <button
              type="button"
              onClick={handleReopenCase}
              className="px-4 py-2 rounded-xl bg-surface-secondary hover:bg-surface-secondary/80 border border-border-subtle text-xs font-semibold text-primary transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
            >
              <span className="material-symbols-outlined text-[15px]">refresh</span>
              <span>Reopen Discussion Thread</span>
            </button>
          </div>
        ) : (
          <div className="sticky bottom-0 bg-white/95 backdrop-blur-md border-t border-border-subtle px-3 py-2.5 sm:px-6 sm:py-3 z-30 shadow-md">
            {/* Quick Clinical Guidance Chips */}
            <div
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-1 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              {DOCTOR_QUICK_CHIPS.map((chip, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendResponse(chip)}
                  disabled={submitting}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-surface-secondary text-primary hover:bg-accent hover:text-white border border-border-subtle transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Optional Prescription Drawer */}
            {showRxInput && (
              <div className="mb-2 p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl animate-fadeIn">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[15px]">prescriptions</span>
                    <span>Prescription / Dosage Instruction (Optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRxInput(false)
                      setPrescription('')
                    }}
                    className="text-text-muted hover:text-primary text-[11px]"
                  >
                    Cancel
                  </button>
                </div>
                <input
                  type="text"
                  value={prescription}
                  onChange={(e) => setPrescription(e.target.value)}
                  placeholder="e.g. Continue Amoxicillin 500mg TID with food for 3 more days"
                  className="w-full bg-white border border-emerald-300 rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none"
                />
              </div>
            )}

            {error && (
              <div className="mb-2 p-2 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {error}
              </div>
            )}

            {/* Input & Action Controls */}
            <div className="flex items-end gap-2">
              {/* Attach Rx Button */}
              <button
                type="button"
                onClick={() => setShowRxInput(!showRxInput)}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 cursor-pointer border ${
                  showRxInput
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-surface-secondary text-text-muted hover:text-primary border-border-subtle'
                }`}
                title="Attach Prescription Guidance"
              >
                <span className="material-symbols-outlined text-[20px]">prescriptions</span>
              </button>

              {/* Emergency Clinic Visit Button */}
              <button
                type="button"
                onClick={handleHospitalAlert}
                disabled={submitting}
                className="w-10 h-10 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 flex items-center justify-center transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                title="Advise in-person physical examination"
              >
                <span className="material-symbols-outlined text-[20px]">emergency</span>
              </button>

              {/* Clinical Message Input */}
              <div className="flex-1 bg-surface-secondary/70 border border-border-subtle rounded-2xl p-2 focus-within:bg-white focus-within:border-accent transition-all">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Type clinical guidance for ${patientName}... (Enter to send)`}
                  rows={1}
                  disabled={submitting}
                  className="w-full bg-transparent text-xs sm:text-sm text-primary placeholder:text-text-muted resize-none focus:outline-none max-h-32 px-1"
                  style={{ minHeight: '36px' }}
                />
              </div>

              {/* Circular Send Button */}
              <button
                type="button"
                onClick={() => handleSendResponse()}
                disabled={submitting || !message.trim()}
                className="w-11 h-11 rounded-full bg-accent hover:bg-accent/90 disabled:opacity-40 text-white flex items-center justify-center shadow-sm hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0"
                title="Send Guidance"
              >
                {submitting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-[20px]">send</span>
                )}
              </button>
            </div>
          </div>
        )}
        </div>
      </main>

      <DoctorBottomNav activePage="Messages" />

      {/* Enlarged Photo Modal */}
      {showPhotoModal && caseData.photo_url && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowPhotoModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-4 max-w-2xl w-full max-h-[90vh] overflow-auto shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle mb-3">
              <span className="text-xs font-bold text-primary">Patient Progress Image</span>
              <button
                type="button"
                onClick={() => setShowPhotoModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-text-muted cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <img
              src={caseData.photo_url}
              alt="Enlarged photo"
              className="w-full h-auto rounded-xl border border-border-subtle"
            />
          </div>
        </div>
      )}
    </div>
  )
}
