'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'

type CaseData = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
  target_response_by: string
  created_at: string
  doctor_id: string | null
}

type ThreadMessage = {
  id: string
  senderRole: 'doctor' | 'patient'
  senderName: string
  message: string
  prescription?: string | null
  createdAt: string
  isLocalFallback?: boolean
}

const statusStyles: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Pending Doctor Review', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  in_review: { label: 'Doctor Reviewing', badge: 'bg-blue-50 text-blue-800 border-blue-200' },
  responded: { label: 'Doctor Responded', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  closed: { label: 'Discussion Closed', badge: 'bg-gray-100 text-gray-600 border-gray-200' },
}

const urgencyLabels: Record<string, { label: string; dot: string }> = {
  routine: { label: 'Routine Concern', dot: 'bg-emerald-500' },
  somewhat_urgent: { label: 'Needs Attention', dot: 'bg-amber-500' },
  needs_live_call: { label: 'Priority Inquiry', dot: 'bg-red-600' },
}

const QUICK_CHIPS = [
  '💊 Took my scheduled dose',
  '✅ Feeling much better today',
  '⚠️ Experiencing mild side effects',
  '❓ Question about medication timing',
]

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

export default function CaseDetailPage() {
  const [userId, setUserId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [doctorName, setDoctorName] = useState('Your Doctor')
  const [doctorSpecialty, setDoctorSpecialty] = useState('Attending Physician')
  const [effectiveDoctorId, setEffectiveDoctorId] = useState<string | null>(null)
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [showCaseDetails, setShowCaseDetails] = useState(false)
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

  const loadCase = useCallback(async () => {
    if (!caseId) return

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
      .maybeSingle()
    if (profile?.full_name) setFullName(profile.full_name)

    const { data: theCase } = await supabase
      .from('cases')
      .select('id, symptoms_description, photo_url, urgency, status, target_response_by, created_at, doctor_id')
      .eq('id', caseId)
      .eq('patient_id', user.id)
      .maybeSingle()

    if (theCase) {
      setCaseData(theCase)

      // 1. Resolve Doctor Info
      let resolvedDoctorId = theCase.doctor_id
      let resolvedDoctorName = 'Your Doctor'
      let resolvedSpecialty = 'Attending Physician'

      // Check legacy responses for doctor_id
      const { data: theResponses } = await supabase
        .from('responses')
        .select('id, message, prescription, created_at, doctor_id')
        .eq('cases_id', caseId)
        .order('created_at', { ascending: true })

      if (theResponses && theResponses.length > 0 && !resolvedDoctorId) {
        resolvedDoctorId = theResponses[theResponses.length - 1].doctor_id
      }

      // Check enrollment if still null
      if (!resolvedDoctorId) {
        const { data: enroll } = await supabase
          .from('enrollments')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (enroll?.doctor_id) resolvedDoctorId = enroll.doctor_id
      }

      // Check care plan if still null
      if (!resolvedDoctorId) {
        const { data: cp } = await supabase
          .from('care_plans')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (cp?.doctor_id) resolvedDoctorId = cp.doctor_id
      }

      setEffectiveDoctorId(resolvedDoctorId)

      if (resolvedDoctorId) {
        const { data: doctorProfile } = await supabase
          .from('profiles')
          .select('full_name, specialty')
          .eq('id', resolvedDoctorId)
          .maybeSingle()

        if (doctorProfile?.full_name) {
          resolvedDoctorName = doctorProfile.full_name
          setDoctorName(resolvedDoctorName)
        }
        if (doctorProfile?.specialty) {
          resolvedSpecialty = doctorProfile.specialty
          setDoctorSpecialty(resolvedSpecialty)
        }
      }

      // 2. Build Chat Thread (Chronological Order)
      const threaded: ThreadMessage[] = []
      const docDisplayName = formatDoctorName(resolvedDoctorName)

      // A. Add legacy responses
      if (theResponses && theResponses.length > 0) {
        for (const r of theResponses) {
          threaded.push({
            id: r.id,
            senderRole: 'doctor',
            senderName: docDisplayName,
            message: r.message,
            prescription: r.prescription,
            createdAt: r.created_at,
          })
        }
      }

      // B. Query case_messages table (wrapped in try/catch for schema cache resilience)
      try {
        const { data: messagesData, error: messagesErr } = await supabase
          .from('case_messages')
          .select('id, message, sender_id, sender_role, created_at')
          .eq('case_id', caseId)
          .order('created_at', { ascending: true })

        if (!messagesErr && messagesData && messagesData.length > 0) {
          for (const m of messagesData) {
            const role = m.sender_role as 'doctor' | 'patient'
            const isDuplicate = threaded.some((t) =>
              isSameMessage(t, { id: m.id, message: m.message, senderRole: role, createdAt: m.created_at })
            )
            if (!isDuplicate) {
              threaded.push({
                id: m.id,
                senderRole: role,
                senderName: role === 'doctor' ? docDisplayName : (profile?.full_name || 'You'),
                message: m.message,
                createdAt: m.created_at,
              })
            }
          }
        }
      } catch {
        // Table not yet migrated in remote Supabase schema cache — fallback silently
      }

      // C. Load local persisted messages (self-healing fallback)
      try {
        const localKey = `mediq_chat_${caseId}`
        const cachedStr = localStorage.getItem(localKey)
        if (cachedStr) {
          const cachedMsgs: ThreadMessage[] = JSON.parse(cachedStr)
          for (const cm of cachedMsgs) {
            const isDuplicate = threaded.some((t) => isSameMessage(t, cm))
            if (!isDuplicate) {
              threaded.push(cm)
            }
          }
        }
      } catch {
        // LocalStorage fallback error ignored
      }

      // D. Parse [Patient Follow-Up] or [Doctor Reply] blocks embedded in symptoms_description if present
      if (theCase.symptoms_description) {
        const followUpRegex = /\[Patient Follow-Up\s*-\s*([^\]]+)\]:\s*([\s\S]*?)(?=\n\n\[|$)/gi
        let match
        while ((match = followUpRegex.exec(theCase.symptoms_description)) !== null) {
          const timestampStr = match[1].trim()
          const content = match[2].trim()
          const exists = threaded.some((t) => t.message.trim() === content)
          if (!exists && content) {
            threaded.push({
              id: `parsed_${Math.random().toString(36).slice(2)}`,
              senderRole: 'patient',
              senderName: profile?.full_name || 'You',
              message: content,
              createdAt: theCase.created_at,
            })
          }
        }
      }

      // Sort entire thread chronologically
      threaded.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      setThreadMessages(threaded)
    }

    setLoading(false)
  }, [caseId, router])

  useEffect(() => {
    loadCase()
  }, [loadCase])

  // Resilient helper to fetch new messages without full reload
  const fetchNewMessages = useCallback(async () => {
    if (!caseId) return
    try {
      const { data: messagesData } = await supabase
        .from('case_messages')
        .select('id, sender_id, sender_role, message, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true })

      if (messagesData && messagesData.length > 0) {
        setThreadMessages((prev) => {
          let hasNew = false
          const updated = [...prev]
          for (const msg of messagesData) {
            const role = msg.sender_role as 'doctor' | 'patient'
            const exists = updated.some((t) =>
              isSameMessage(t, { id: msg.id, message: msg.message, senderRole: role, createdAt: msg.created_at })
            )
            if (!exists) {
              hasNew = true
              updated.push({
                id: msg.id,
                senderRole: role,
                senderName: role === 'doctor' ? doctorName : (fullName || 'You'),
                message: msg.message,
                createdAt: msg.created_at,
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
  }, [caseId, doctorName, fullName])

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
                  senderName: role === 'doctor' ? doctorName : (fullName || 'You'),
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
                senderName: p.sender_name || (role === 'doctor' ? doctorName : (fullName || 'You')),
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
  }, [caseId, loading, doctorName, fullName, fetchNewMessages])

  useEffect(() => {
    if (!loading && threadMessages.length > 0) {
      scrollToBottom(false)
    }
  }, [loading, threadMessages.length])

  // Handle Patient Sending a Message
  const handleSendMessage = async (textToSend?: string) => {
    const rawText = typeof textToSend === 'string' ? textToSend : replyText
    const currentMessage = rawText.trim()
    if (!currentMessage || !caseData || submittingReply) return

    setSubmittingReply(true)
    setReplyError('')

    const tempId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const nowIso = new Date().toISOString()
    const senderDisplayName = fullName || 'You'

    const newMsgItem: ThreadMessage = {
      id: tempId,
      senderRole: 'patient',
      senderName: senderDisplayName,
      message: currentMessage,
      createdAt: nowIso,
    }

    // 1. Optimistic UI update
    setThreadMessages((prev) => [...prev, newMsgItem])
    setReplyText('')
    setTimeout(() => scrollToBottom(true), 50)

    let deliveredViaTable = false
    let realMsgId = tempId
    let realCreatedAt = nowIso

    // 2. Try inserting into case_messages
    try {
      const { data: inserted, error: insertError } = await supabase
        .from('case_messages')
        .insert({
          case_id: caseId,
          sender_id: userId,
          sender_role: 'patient',
          message: currentMessage,
        })
        .select('id, created_at')
        .maybeSingle()

      if (!insertError && inserted) {
        deliveredViaTable = true
        realMsgId = inserted.id
        realCreatedAt = inserted.created_at
        // Update item with database ID
        setThreadMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: realMsgId, createdAt: realCreatedAt } : m))
        )
      }
    } catch {
      // Table missing from schema cache - proceed to self-healing fallback
    }

    // 3. Broadcast via Realtime Channel
    if (channelRef.current) {
      try {
        channelRef.current.send({
          type: 'broadcast',
          event: 'new_message',
          payload: {
            id: realMsgId,
            case_id: caseId,
            sender_id: userId,
            sender_role: 'patient',
            sender_name: senderDisplayName,
            message: currentMessage,
            created_at: realCreatedAt,
          },
        })
      } catch {
        // Non-blocking
      }
    }

    // 4. Broadcast via window event for local multi-tab sync
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('mediq_chat_message', {
          detail: { caseId, senderRole: 'patient', message: currentMessage },
        })
      )
    }

    // 5. Fallback: If table does not exist, persist to localStorage and cases description
    if (!deliveredViaTable) {
      try {
        const localKey = `mediq_chat_${caseId}`
        const existingLocal: ThreadMessage[] = JSON.parse(localStorage.getItem(localKey) || '[]')
        existingLocal.push(newMsgItem)
        localStorage.setItem(localKey, JSON.stringify(existingLocal))

        // Append to symptoms_description so doctor sees it regardless of migration state
        const timeHeader = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        const updatedDesc = `${caseData.symptoms_description}\n\n[Patient Follow-Up - ${timeHeader}]: ${currentMessage}`
        await supabase
          .from('cases')
          .update({
            symptoms_description: updatedDesc,
            status: 'pending',
          })
          .eq('id', caseId)
      } catch (fallbackErr) {
        console.warn('Fallback storage warning:', fallbackErr)
      }
    } else {
      // If table exists, update case status to pending
      await supabase
        .from('cases')
        .update({ status: 'pending' })
        .eq('id', caseId)

      // Also cache to localStorage
      try {
        const localKey = `mediq_chat_${caseId}`
        const existingLocal: ThreadMessage[] = JSON.parse(localStorage.getItem(localKey) || '[]')
        const isAlreadySaved = existingLocal.some((m) =>
          isSameMessage(m, { id: realMsgId, message: currentMessage, senderRole: 'patient', createdAt: realCreatedAt })
        )
        if (!isAlreadySaved) {
          existingLocal.push({ ...newMsgItem, id: realMsgId, createdAt: realCreatedAt })
          localStorage.setItem(localKey, JSON.stringify(existingLocal))
        }
      } catch {
        // Ignore
      }
    }

    // 6. Notify Attending Doctor securely
    if (effectiveDoctorId) {
      await sendNotification({
        userId: effectiveDoctorId,
        title: 'New Patient Reply',
        message: `${fullName || 'Your patient'} sent a follow-up message regarding their note.`,
        type: 'case_reply',
      })
    }

    setCaseData((prev) => (prev ? { ...prev, status: 'pending' } : null))
    setToastMessage('Message delivered to your doctor')
    setTimeout(() => setToastMessage(null), 3500)
    setSubmittingReply(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const formattedDocName = formatDoctorName(doctorName, 'Your Doctor')

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted text-xs font-semibold">Opening secure chat...</p>
      </div>
    )
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar fullName={fullName} email={email} activePage="My Cases" />
        <DesktopHeader />
        <TopBar />

        <main className="md:ml-64 flex flex-col pb-24 md:pb-8">
          <div className="max-w-[720px] mx-auto w-full px-4 md:px-8 py-16 flex flex-col items-center justify-center text-center">
            <span className="material-symbols-outlined text-text-muted text-5xl mb-4">chat_bubble_outline</span>
            <h2 className="text-xl font-semibold text-primary mb-2">Discussion Not Found</h2>
            <p className="text-sm text-text-muted mb-6">
              The conversation thread you are looking for does not exist or has been removed.
            </p>
            <Link
              href="/cases"
              className="inline-flex items-center gap-2 bg-accent text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to Messages
            </Link>
          </div>
        </main>

        <BottomNav />
      </div>
    )
  }

  const urgencyInfo = urgencyLabels[caseData.urgency] || {
    label: caseData.urgency.replace('_', ' '),
    dot: 'bg-emerald-500',
  }
  const currentStatus = statusStyles[caseData.status] || statusStyles.pending

  return (
    <div className="min-h-screen bg-[#F4F8F7] font-sans antialiased text-primary flex flex-col">
      <Sidebar fullName={fullName} email={email} activePage="My Cases" />
      <DesktopHeader />
      <TopBar />

      {/* Main Chat Canvas */}
      <main className="md:ml-64 flex-1 flex flex-col pt-14 md:pt-0 pb-20 md:pb-6 relative transition-all duration-300 ease-in-out">
        <div className="w-full max-w-4xl mx-auto flex-1 flex flex-col">
          {/* ── Top Chat Bar (Sticky Header) ───────────────────────── */}
        <div className="sticky top-14 md:top-16 z-30 bg-white/95 backdrop-blur-md border-b border-border-subtle px-4 py-3 sm:px-6 shadow-2xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/cases"
              className="w-8 h-8 rounded-full hover:bg-surface-secondary flex items-center justify-center text-text-muted hover:text-primary transition-colors shrink-0"
              title="Back to All Notes"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </Link>

            {/* Doctor Avatar with online indicator */}
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center font-bold text-sm shadow-2xs">
                {formattedDocName.replace(/^Dr\.\s*/, '').charAt(0) || 'D'}
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-primary truncate">
                  {formattedDocName}
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-bold">
                  Physician
                </span>
              </div>
              <p className="text-[11px] text-text-muted truncate">
                {doctorSpecialty} • Mediq Direct Clinical Line
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Link to Messages hub */}
            {caseData.status === 'responded' && (
              <Link
                href={`/messages?caseId=${caseData.id}`}
                className="px-2.5 py-1 bg-accent/10 hover:bg-accent hover:text-white text-accent rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-2xs"
                title="Open full conversation in Messages"
              >
                <span className="material-symbols-outlined text-[15px]">chat</span>
                <span className="hidden sm:inline">Open in Messages</span>
              </Link>
            )}

            {/* Status pill */}
            <span
              className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${currentStatus.badge}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {currentStatus.label}
            </span>

            {/* Toggle Case Details Inquiry Card */}
            <button
              type="button"
              onClick={() => setShowCaseDetails(!showCaseDetails)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-text-muted hover:text-primary hover:bg-surface-secondary border border-border-subtle transition-all flex items-center gap-1 cursor-pointer"
              title="Toggle Initial Concern"
            >
              <span className="material-symbols-outlined text-[16px]">info</span>
              <span className="hidden sm:inline">{showCaseDetails ? 'Hide Note' : 'View Note'}</span>
            </button>
          </div>
        </div>

        {/* ── Toast Notification Banner ────────────────────────── */}
        {toastMessage && (
          <div className="fixed top-18 right-4 md:right-8 z-50 bg-emerald-700 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 animate-bounce">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            <span>{toastMessage}</span>
          </div>
        )}

        {/* ── Collapsible Initial Case Inquiry Anchor ───────────── */}
        {showCaseDetails && (
          <div className="px-4 sm:px-6 pt-3 transition-all animate-fadeIn">
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-accent text-[18px]">medical_services</span>
                  <span className="text-xs font-bold text-primary">Original Consultation Note</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span className={`w-2 h-2 rounded-full ${urgencyInfo.dot}`} />
                  <span>{urgencyInfo.label}</span>
                </div>
              </div>

              <p className="text-xs text-primary leading-relaxed whitespace-pre-wrap mb-3">
                {caseData.symptoms_description.replace(/\n\n\[Patient Follow-Up[\s\S]*$/, '')}
              </p>

              {caseData.photo_url && (
                <div className="pt-2 border-t border-border-subtle flex items-center gap-3">
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
                    <p className="font-semibold text-primary">Attached Progress Photo</p>
                    <p className="text-text-muted">Click photo thumbnail to view enlarged</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Chat Messages Timeline ───────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Date separator */}
          <div className="flex justify-center my-2">
            <span className="px-3 py-1 rounded-full bg-white/80 border border-border-subtle text-[10px] font-bold uppercase tracking-wider text-text-muted shadow-2xs">
              Direct Clinical Thread • {new Date(caseData.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>

          {/* Initial patient symptom note as first anchor bubble on right */}
          <div className="flex justify-end">
            <div className="max-w-[85%] sm:max-w-[75%] bg-accent text-white rounded-2xl rounded-tr-xs p-3.5 sm:p-4 shadow-xs">
              <div className="flex items-center justify-between gap-3 text-[10px] text-white/80 mb-1">
                <span className="font-bold">Initial Clinical Inquiry</span>
                <span>
                  {new Date(caseData.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                {caseData.symptoms_description.replace(/\n\n\[Patient Follow-Up[\s\S]*$/, '')}
              </p>
              {caseData.photo_url && (
                <div
                  onClick={() => setShowPhotoModal(true)}
                  className="mt-2.5 rounded-xl overflow-hidden border border-white/20 cursor-pointer group"
                >
                  <img
                    src={caseData.photo_url}
                    alt="Uploaded attachment"
                    className="max-h-40 w-auto rounded-lg object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="p-1 text-[10px] text-white/90 font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                    <span>Attached progress photo (Tap to view)</span>
                  </div>
                </div>
              )}
              <div className="flex justify-end mt-1 text-white/70">
                <span className="material-symbols-outlined text-[14px]">done_all</span>
              </div>
            </div>
          </div>

          {/* Dynamic Follow-Up Thread Messages */}
          {threadMessages.map((msg, idx) => {
            const isDoctor = msg.senderRole === 'doctor'

            if (isDoctor) {
              return (
                /* Doctor Message Bubble (Left) */
                <div key={msg.id || idx} className="flex items-start gap-2 max-w-[85%] sm:max-w-[75%] animate-fadeIn">
                  <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs mt-1">
                    Dr
                  </div>
                  <div className="bg-white border border-border-subtle rounded-2xl rounded-tl-xs p-3.5 sm:p-4 text-primary shadow-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-primary">{msg.senderName}</span>
                      <span className="px-1.5 py-0.2 rounded-full bg-accent/10 text-accent text-[9px] font-bold">
                        Physician
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap text-primary">
                      {msg.message}
                    </p>

                    {/* Prescription Card inside bubble */}
                    {msg.prescription && (
                      <div className="mt-2.5 p-3 rounded-xl bg-emerald-50/80 border border-emerald-200">
                        <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-[10px] uppercase tracking-wide mb-1">
                          <span className="material-symbols-outlined text-[15px]">prescriptions</span>
                          <span>Doctor Prescription Guidance</span>
                        </div>
                        <p className="text-xs font-semibold text-emerald-950">{msg.prescription}</p>
                      </div>
                    )}

                    <div className="flex justify-end mt-1 text-[10px] text-text-muted">
                      <span>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            } else {
              return (
                /* Patient Message Bubble (Right) */
                <div key={msg.id || idx} className="flex justify-end animate-fadeIn">
                  <div className="max-w-[85%] sm:max-w-[75%] bg-accent text-white rounded-2xl rounded-tr-xs p-3.5 sm:p-4 shadow-xs">
                    <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.message}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-white/80">
                      <span>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="material-symbols-outlined text-[14px]">done_all</span>
                    </div>
                  </div>
                </div>
              )
            }
          })}

          {/* Awaiting Doctor Response Empty Indicator */}
          {threadMessages.length === 0 && (
            <div className="flex justify-center my-6">
              <div className="bg-white/80 border border-border-subtle rounded-2xl p-4 text-center max-w-sm shadow-2xs">
                <span className="material-symbols-outlined text-accent text-2xl mb-1">mark_chat_unread</span>
                <p className="text-xs font-semibold text-primary">
                  {formattedDocName} has been notified
                </p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Your physician will review your inquiry and reply directly into this thread. You can send additional follow-ups below.
                </p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Sticky Mobile-First Action Bar (Active vs Awaiting vs Closed) ── */}
        {caseData.status === 'closed' || caseData.status === 'resolved' ? (
          <div className="sticky bottom-0 bg-white/95 backdrop-blur-md border-t border-border-subtle p-4 z-30 shadow-md text-center">
            <div className="flex items-center justify-center gap-2 text-emerald-800 font-bold text-xs mb-1">
              <span className="material-symbols-outlined text-[18px] text-emerald-600">task_alt</span>
              <span>Case Solved &bull; Message Thread Closed</span>
            </div>
            <p className="text-[11px] text-text-muted max-w-md mx-auto mb-2.5">
              This consultation has been resolved by {formattedDocName}. The discussion thread is closed until you submit a new case.
            </p>
            <Link
              href="/submit-case"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              <span>Submit a New Case</span>
            </Link>
          </div>
        ) : (caseData.status === 'pending' || caseData.status === 'in_review') && threadMessages.filter((m) => m.senderRole === 'doctor').length === 0 ? (
          <div className="sticky bottom-0 bg-white/95 backdrop-blur-md border-t border-border-subtle p-4 z-30 shadow-md text-center">
            <div className="flex items-center justify-center gap-2 text-amber-800 font-bold text-xs mb-1">
              <span className="material-symbols-outlined text-[18px] text-amber-600 animate-pulse">hourglass_top</span>
              <span>Awaiting Doctor Initial Response</span>
            </div>
            <p className="text-[11px] text-text-muted max-w-md mx-auto mb-2.5">
              Your case has been submitted. Your interactive message thread will unlock in Messages once your physician posts their initial assessment.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Link
                href="/cases"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-surface-secondary hover:bg-surface-secondary/80 text-primary border border-border-subtle rounded-xl text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">folder_shared</span>
                <span>Back to My Cases</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="sticky bottom-0 bg-white/95 backdrop-blur-md border-t border-border-subtle px-3 py-2.5 sm:px-6 sm:py-3 z-30 shadow-md">
            {/* Quick Action Chips */}
            <div
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-1 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              {QUICK_CHIPS.map((chip, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendMessage(chip)}
                  disabled={submittingReply}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-surface-secondary text-primary hover:bg-accent hover:text-white border border-border-subtle transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>

            {replyError && (
              <div className="mb-2 p-2 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {replyError}
              </div>
            )}

            {/* Input & Send Action Row */}
            <div className="flex items-end gap-2">
              <div className="flex-1 bg-surface-secondary/70 border border-border-subtle rounded-2xl p-2 focus-within:bg-white focus-within:border-accent transition-all">
                <textarea
                  ref={textareaRef}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${formattedDocName}... (Press Enter to send)`}
                  rows={1}
                  disabled={submittingReply}
                  className="w-full bg-transparent text-xs sm:text-sm text-primary placeholder:text-text-muted resize-none focus:outline-none max-h-32 px-1"
                  style={{ minHeight: '36px' }}
                />
              </div>

              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={submittingReply || !replyText.trim()}
                className="w-11 h-11 rounded-full bg-accent hover:bg-accent/90 disabled:opacity-40 text-white flex items-center justify-center shadow-sm hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0"
                title="Send Message"
              >
                {submittingReply ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-[20px]">send</span>
                )}
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-1 text-center hidden sm:block">
              Messages are transmitted directly to {formattedDocName}. In life-threatening medical emergencies, call local emergency services immediately.
            </p>
          </div>
        )}
        </div>
      </main>

      <BottomNav />

      {/* Photo Enlarge Modal */}
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
              <span className="text-xs font-bold text-primary">Attached Clinical Progress Photo</span>
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