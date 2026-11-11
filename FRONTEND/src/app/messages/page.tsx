'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications'
import { computeCaseSLA } from '@/lib/sla'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'

type CaseSummary = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
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

const statusLabels: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Awaiting Doctor Review', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  in_review: { label: 'Doctor Reviewing', badge: 'bg-blue-50 text-blue-800 border-blue-200' },
  responded: { label: 'Active Discussion', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  resolved: { label: 'Case Solved • Closed', badge: 'bg-gray-100 text-gray-700 border-gray-300' },
  closed: { label: 'Case Solved • Closed', badge: 'bg-gray-100 text-gray-700 border-gray-300' },
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

function MessagesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedCaseId = searchParams.get('caseId')

  const [loading, setLoading] = useState(true)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState('')
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [selectedCase, setSelectedCase] = useState<CaseSummary | null>(null)
  const [doctorName, setDoctorName] = useState('Your Doctor')
  const [doctorSpecialty, setDoctorSpecialty] = useState('Attending Physician')
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const [showCaseDetails, setShowCaseDetails] = useState(false)
  const [showPhotoModal, setShowPhotoModal] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }

  // Load all user cases
  const loadUserCases = useCallback(async () => {
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

    const { data: casesData } = await supabase
      .from('cases')
      .select('id, symptoms_description, photo_url, urgency, status, created_at, doctor_id')
      .eq('patient_id', user.id)
      .order('created_at', { ascending: false })

    const userCases: CaseSummary[] = casesData || []
    setCases(userCases)

    // Determine which case to select:
    // 1. If requestedCaseId is provided and exists, pick that.
    // 2. Otherwise pick the most recent case that is responded or active.
    // 3. Otherwise pick the most recent case.
    let targetCase: CaseSummary | null = null
    if (requestedCaseId) {
      targetCase = userCases.find((c) => c.id === requestedCaseId) || null
    }
    if (!targetCase && userCases.length > 0) {
      const respondedCase = userCases.find((c) => c.status === 'responded')
      targetCase = respondedCase || userCases[0]
    }
    setSelectedCase(targetCase)
    setLoading(false)
  }, [requestedCaseId, router])

  useEffect(() => {
    loadUserCases()
  }, [loadUserCases])

  // When selectedCase changes, fetch its doctor and thread messages
  const loadThread = useCallback(async () => {
    if (!selectedCase) {
      setThreadMessages([])
      return
    }

    // Resolve Doctor Profile
    let effectiveDocId = selectedCase.doctor_id
    if (!effectiveDocId) {
      // Check enrollment
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('doctor_id')
        .eq('patient_id', userId)
        .maybeSingle()
      if (enrollment?.doctor_id) effectiveDocId = enrollment.doctor_id
    }

    if (effectiveDocId) {
      const { data: docProfile } = await supabase
        .from('profiles')
        .select('full_name, specialty')
        .eq('id', effectiveDocId)
        .maybeSingle()
      if (docProfile?.full_name) {
        setDoctorName(formatDoctorName(docProfile.full_name))
      }
      if (docProfile?.specialty) {
        setDoctorSpecialty(docProfile.specialty)
      }
    }

    const threaded: ThreadMessage[] = []

    // 1. Fetch official responses from doctor
    const { data: responsesData } = await supabase
      .from('responses')
      .select('id, message, prescription, created_at, doctor_id')
      .eq('cases_id', selectedCase.id)
      .order('created_at', { ascending: true })

    if (responsesData && responsesData.length > 0) {
      for (const resp of responsesData) {
        threaded.push({
          id: resp.id,
          senderRole: 'doctor',
          senderName: doctorName || 'Attending Physician',
          message: resp.message,
          prescription: resp.prescription,
          createdAt: resp.created_at,
        })
      }
    }

    // 2. Fetch messages from case_messages
    try {
      const { data: messagesData } = await supabase
        .from('case_messages')
        .select('id, sender_id, sender_role, message, created_at')
        .eq('case_id', selectedCase.id)
        .order('created_at', { ascending: true })

      if (messagesData && messagesData.length > 0) {
        for (const msg of messagesData) {
          const role = msg.sender_role as 'doctor' | 'patient'
          const isDuplicate = threaded.some((t) =>
            isSameMessage(t, { id: msg.id, message: msg.message, senderRole: role, createdAt: msg.created_at })
          )
          if (!isDuplicate) {
            threaded.push({
              id: msg.id,
              senderRole: role,
              senderName: role === 'doctor' ? doctorName : (fullName || 'You'),
              message: msg.message,
              createdAt: msg.created_at,
            })
          }
        }
      }
    } catch {
      // Schema cache fallback
    }

    // 3. Merge local cached messages
    try {
      const cached = localStorage.getItem(`mediq_chat_${selectedCase.id}`)
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
      // Ignore
    }

    threaded.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    setThreadMessages(threaded)
  }, [selectedCase, userId, doctorName, fullName])

  useEffect(() => {
    loadThread()
  }, [loadThread])

  // Resilient helper to fetch new messages without full reload
  const fetchNewMessages = useCallback(async () => {
    if (!selectedCase?.id) return
    try {
      const { data: messagesData } = await supabase
        .from('case_messages')
        .select('id, sender_id, sender_role, message, created_at')
        .eq('case_id', selectedCase.id)
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
  }, [selectedCase?.id, doctorName, fullName])

  // Real-time synchronization and auto-polling
  useEffect(() => {
    if (!selectedCase?.id || loading) return

    let isMounted = true
    let pollInterval: NodeJS.Timeout | null = null

    // 1. Supabase Realtime Channel
    const channelName = `mediq_chat_${selectedCase.id}`
    const channel = supabase.channel(channelName)

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'case_messages',
          filter: `case_id=eq.${selectedCase.id}`,
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
  }, [selectedCase?.id, loading, doctorName, fullName, fetchNewMessages])

  useEffect(() => {
    if (!loading && threadMessages.length > 0) {
      scrollToBottom(false)
    }
  }, [loading, threadMessages.length])

  // Send Patient Reply
  const handleSendMessage = async (textToSend?: string) => {
    if (!selectedCase) return
    const text = typeof textToSend === 'string' ? textToSend : replyText
    const current = text.trim()
    if (!current || submittingReply) return

    setSubmittingReply(true)
    const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const nowIso = new Date().toISOString()
    const newMsg: ThreadMessage = {
      id: tempId,
      senderRole: 'patient',
      senderName: fullName || 'You',
      message: current,
      createdAt: nowIso,
      isLocalFallback: true,
    }

    setThreadMessages((prev) => [...prev, newMsg])
    setReplyText('')
    setTimeout(() => scrollToBottom(true), 50)

    let realMsgId = tempId
    let realCreatedAt = nowIso

    // Attempt Supabase insert
    try {
      const { data: inserted } = await supabase
        .from('case_messages')
        .insert({
          case_id: selectedCase.id,
          sender_id: userId,
          sender_role: 'patient',
          message: current,
        })
        .select('id, created_at')
        .maybeSingle()

      if (inserted) {
        realMsgId = inserted.id
        realCreatedAt = inserted.created_at
        setThreadMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: realMsgId, createdAt: realCreatedAt } : m))
        )
      }
    } catch {
      // Non-blocking
    }

    // Broadcast via Realtime Channel
    if (channelRef.current) {
      try {
        channelRef.current.send({
          type: 'broadcast',
          event: 'new_message',
          payload: {
            id: realMsgId,
            case_id: selectedCase.id,
            sender_id: userId,
            sender_role: 'patient',
            sender_name: fullName || 'You',
            message: current,
            created_at: realCreatedAt,
          },
        })
      } catch {
        // Non-blocking
      }
    }

    // Broadcast via window event for local multi-tab sync
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('mediq_chat_message', {
          detail: { caseId: selectedCase.id, senderRole: 'patient', message: current },
        })
      )
    }

    // Save to local cache
    try {
      const localKey = `mediq_chat_${selectedCase.id}`
      const existing: ThreadMessage[] = JSON.parse(localStorage.getItem(localKey) || '[]')
      const isAlreadySaved = existing.some((m) =>
        isSameMessage(m, { id: realMsgId, message: current, senderRole: 'patient', createdAt: realCreatedAt })
      )
      if (!isAlreadySaved) {
        existing.push({ ...newMsg, id: realMsgId, createdAt: realCreatedAt })
        localStorage.setItem(localKey, JSON.stringify(existing))
      }
    } catch {
      // Ignore
    }

    // Notify doctor
    if (selectedCase.doctor_id) {
      await sendNotification({
        userId: selectedCase.doctor_id,
        title: 'New Patient Reply',
        message: `${fullName || 'Patient'} replied to clinical case #${selectedCase.id.slice(0, 8)}`,
        type: 'case_reply',
      })
    }

    setSubmittingReply(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted text-xs font-semibold">Loading messages...</p>
      </div>
    )
  }

  const hasResponded = selectedCase && (selectedCase.status === 'responded' || threadMessages.some((m) => m.senderRole === 'doctor'))
  const isCaseClosed = selectedCase && (selectedCase.status === 'closed' || selectedCase.status === 'resolved')
  const isAwaitingResponse = selectedCase && (selectedCase.status === 'pending' || selectedCase.status === 'in_review') && !hasResponded
  const sla = selectedCase ? computeCaseSLA(selectedCase.urgency, selectedCase.created_at, selectedCase.status) : null

  return (
    <div className="min-h-screen bg-[#F7FAF9] font-sans antialiased text-primary flex flex-col">
      <Sidebar fullName={fullName} email={email} activePage="Messages" />
      <DesktopHeader />
      <TopBar />

      <main className="md:ml-64 flex-1 flex flex-col pb-20 md:pb-6 relative transition-all duration-300 ease-in-out">
        <div className="w-full max-w-4xl mx-auto flex-1 flex flex-col">
          {/* ── Top Header & Case Thread Selector ─────────────────── */}
          <div className="sticky top-14 md:top-16 z-30 bg-white/95 backdrop-blur-md border-b border-border-subtle px-4 py-3 sm:px-6 shadow-2xs">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Link
                  href="/cases"
                  className="w-8 h-8 rounded-full hover:bg-surface-secondary flex items-center justify-center text-text-muted hover:text-primary transition-colors shrink-0"
                  title="View All Cases"
                >
                  <span className="material-symbols-outlined text-[20px]">folder_shared</span>
                </Link>

                {/* Doctor Avatar */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center font-bold text-sm shadow-2xs">
                    {doctorName.replace(/^Dr\.\s*/i, '').charAt(0) || 'D'}
                  </div>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-sm sm:text-base font-bold text-primary truncate">
                      {doctorName}
                    </h1>
                    <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-accent/10 text-accent border border-accent/20">
                      {doctorSpecialty}
                    </span>
                    {isAwaitingResponse && sla && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${sla.isBreached
                            ? 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                            : sla.isWarning
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-surface-secondary text-text-muted border-border-subtle'
                          }`}
                      >
                        <span className="material-symbols-outlined text-[11px]">
                          {sla.isBreached ? 'emergency' : 'schedule'}
                        </span>
                        <span>{sla.isBreached ? 'Priority Escalated' : `Target: ${sla.timeRemainingStr}`}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-text-muted flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>Clinical Direct Messaging</span>
                    {selectedCase && (
                      <span className="text-text-muted/60">
                        • Case #{selectedCase.id.slice(0, 8)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {selectedCase && (
                  <button
                    type="button"
                    onClick={() => setShowCaseDetails(!showCaseDetails)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-primary hover:bg-surface-secondary border border-border-subtle transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">info</span>
                    <span className="hidden sm:inline">{showCaseDetails ? 'Hide Note' : 'Case Note'}</span>
                  </button>
                )}

                <Link
                  href="/submit-case"
                  className="px-3 py-1.5 bg-accent hover:bg-accent/90 text-white rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[15px]">add</span>
                  <span className="hidden sm:inline">New Case</span>
                </Link>
              </div>
            </div>

            {/* If patient has multiple cases, show case switcher tabs */}
            {cases.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pt-2 mt-2 border-t border-border-subtle/60 scrollbar-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted shrink-0">
                  Threads:
                </span>
                {cases.map((c) => {
                  const isSelected = selectedCase?.id === c.id
                  const isClosed = c.status === 'closed' || c.status === 'resolved'
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCase(c)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border ${isSelected
                          ? 'bg-primary text-white border-primary shadow-2xs'
                          : 'bg-white text-text-muted border-border-subtle hover:border-primary/40'
                        }`}
                    >
                      <span>Case #{c.id.slice(0, 6)}</span>
                      <span
                        className={`text-[9px] px-1 rounded-full ${isSelected
                            ? 'bg-white/20 text-white'
                            : isClosed
                              ? 'bg-gray-100 text-gray-500'
                              : c.status === 'responded'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                      >
                        {isClosed ? 'Closed' : c.status}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Collapsible Case Inquiry Summary ────────────────────── */}
          {showCaseDetails && selectedCase && (
            <div className="px-4 sm:px-6 pt-3 animate-fadeIn">
              <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-accent text-[18px]">clinical_notes</span>
                    <span className="text-xs font-bold text-primary">Original Consultation Note</span>
                  </div>
                  <span className="text-[10px] text-text-muted font-mono">
                    Submitted {new Date(selectedCase.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-primary leading-relaxed whitespace-pre-wrap bg-surface-secondary/50 p-3 rounded-xl border border-border-subtle">
                  {selectedCase.symptoms_description}
                </p>
                {selectedCase.photo_url && (
                  <div className="pt-1 flex items-center gap-3">
                    <div
                      onClick={() => setShowPhotoModal(true)}
                      className="relative rounded-lg overflow-hidden border border-border-subtle cursor-pointer group shrink-0"
                    >
                      <img
                        src={selectedCase.photo_url}
                        alt="Progress Thumbnail"
                        className="w-14 h-14 object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                        <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                      </div>
                    </div>
                    <span className="text-[11px] text-text-muted">Attached progress image</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STATE A: No cases submitted yet ────────────────────── */}
          {cases.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-accent/10 text-accent flex items-center justify-center mb-4 shadow-xs">
                <span className="material-symbols-outlined text-3xl">chat_bubble_outline</span>
              </div>
              <h2 className="text-lg font-bold text-primary mb-1">No Active Message Thread</h2>
              <p className="text-xs text-text-muted max-w-sm mb-6 leading-relaxed">
                Message threads are created when you submit a consultation case and your doctor reviews and responds. You have not submitted any cases yet.
              </p>
              <Link
                href="/submit-case"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                <span>Submit a Consultation Case</span>
              </Link>
            </div>
          ) : isAwaitingResponse ? (
            /* ── STATE B: Case submitted, awaiting doctor response ────── */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto w-full">
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 border ${sla?.isBreached
                    ? 'bg-red-500/10 text-red-700 border-red-200'
                    : 'bg-amber-500/10 text-amber-700 border-amber-200'
                  }`}
              >
                <span className="material-symbols-outlined text-3xl animate-pulse">
                  {sla?.isBreached ? 'emergency' : 'hourglass_top'}
                </span>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold border mb-3 ${sla?.isBreached
                    ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
              >
                {sla?.isBreached ? 'Clinical Priority Escalated' : 'Pending Doctor Review'}
              </span>
              <h2 className="text-lg font-bold text-primary mb-1">
                {sla?.isBreached ? 'Priority Clinical Review Active' : 'Awaiting Doctor Response'}
              </h2>
              <p className="text-xs text-text-muted max-w-md mb-4 leading-relaxed">
                {sla?.isBreached
                  ? `Case #${selectedCase?.id.slice(0, 8)} has exceeded our standard triage window (${sla.slaLabel}) and has been automatically escalated to our on-call clinical physician pool for expedited review.`
                  : `Case #${selectedCase?.id.slice(0, 8)} has been submitted to your physician and is queued for evaluation${sla ? ` (Target: within ${sla.timeRemainingStr})` : ''}. Your interactive thread unlocks as soon as your doctor posts their evaluation.`}
              </p>

              {/* Emergency Safety Box when SLA is breached */}
              {sla?.isBreached && (
                <div className="w-full bg-red-50/80 border border-red-200 rounded-2xl p-3.5 mb-5 text-left text-xs">
                  <div className="flex items-center gap-1.5 text-red-800 font-bold mb-1">
                    <span className="material-symbols-outlined text-[16px] text-red-600">crisis_alert</span>
                    <span>Safety &amp; Emergency Notice</span>
                  </div>
                  <p className="text-red-700 leading-relaxed text-[11px]">
                    If you are experiencing acute shortness of breath, severe chest pain, sudden numbness, or life-threatening symptoms, <strong>do not wait for this digital reply</strong>. Please call emergency services (911/112) or go to the nearest emergency room immediately.
                  </p>
                </div>
              )}

              <div className="bg-white border border-border-subtle rounded-2xl p-4 max-w-md w-full text-left shadow-xs mb-6">
                <div className="flex items-center justify-between text-[11px] text-text-muted border-b border-border-subtle pb-2 mb-2">
                  <span className="font-semibold text-primary">Case Note Details</span>
                  <span>Submitted {new Date(selectedCase?.created_at || '').toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-primary line-clamp-3 leading-relaxed">
                  {selectedCase?.symptoms_description}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  href="/cases"
                  className="px-4 py-2 bg-surface-secondary hover:bg-surface-secondary/80 text-primary rounded-xl text-xs font-bold border border-border-subtle transition-all"
                >
                  Track in My Cases
                </Link>
                <Link
                  href="/submit-case"
                  className="px-4 py-2 bg-accent text-white rounded-xl text-xs font-bold hover:bg-accent/90 transition-all shadow-2xs"
                >
                  Submit Another Case
                </Link>
              </div>
            </div>
          ) : (
            /* ── STATE C & D: Chat stream (Active or Closed) ─────────── */
            <>
              {/* Case Closed Banner if Solved */}
              {isCaseClosed && (
                <div className="mx-4 sm:mx-6 mt-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-primary flex items-start gap-3 shadow-2xs">
                  <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <span className="material-symbols-outlined text-[20px]">task_alt</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-emerald-950 flex items-center gap-2">
                      <span>Case Solved • Message Thread Closed</span>
                    </h3>
                    <p className="text-[11px] sm:text-xs text-emerald-900/80 mt-0.5 leading-relaxed">
                      This consultation has been concluded and resolved by {doctorName}. The discussion thread is now closed. If you have new symptoms or need further medical review, please submit a new case.
                    </p>
                  </div>
                </div>
              )}

              {/* Chat Messages Stream */}
              <div className="flex-1 px-4 sm:px-6 py-4 space-y-3.5 overflow-y-auto">
                {threadMessages.map((msg) => {
                  const isDoctor = msg.senderRole === 'doctor'

                  return (
                    <div
                      key={msg.id}
                      className={`flex items-end gap-2.5 ${isDoctor ? 'justify-start' : 'justify-end'}`}
                    >
                      {isDoctor && (
                        <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shrink-0 mb-1 shadow-2xs">
                          {doctorName.replace(/^Dr\.\s*/i, '').charAt(0) || 'D'}
                        </div>
                      )}

                      <div
                        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3.5 shadow-2xs text-xs sm:text-sm transition-all ${isDoctor
                            ? 'bg-white border border-border-subtle text-primary rounded-bl-xs'
                            : 'bg-accent text-white rounded-br-xs'
                          }`}
                      >
                        {/* Doctor header */}
                        {isDoctor && (
                          <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-border-subtle/50">
                            <span className="font-bold text-[11px] text-accent">
                              {msg.senderName}
                            </span>
                            <span className="text-[9px] text-text-muted bg-surface-secondary px-1.5 py-0.2 rounded font-semibold">
                              Clinical Note
                            </span>
                          </div>
                        )}

                        {/* Message Body */}
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {msg.message}
                        </p>

                        {/* Prescription Card */}
                        {msg.prescription && (
                          <div className="mt-2.5 p-2.5 rounded-xl bg-accent/5 border border-accent/20 flex items-start gap-2">
                            <span className="material-symbols-outlined text-accent text-[18px] shrink-0 mt-0.5">
                              prescriptions
                            </span>
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                                Prescription / Regimen Guidance
                              </span>
                              <p className="text-xs text-primary font-medium mt-0.5 leading-relaxed">
                                {msg.prescription}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Timestamp & Status */}
                        <div
                          className={`flex items-center justify-end gap-1 mt-1.5 text-[10px] ${isDoctor ? 'text-text-muted' : 'text-white/70'
                            }`}
                        >
                          <span>
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {!isDoctor && (
                            <span className="material-symbols-outlined text-[13px]">
                              done_all
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* ── Chat Bottom Bar (Active vs Closed) ───────────────── */}
              {isCaseClosed ? (
                /* Thread Closed Footer */
                <div className="sticky bottom-0 z-30 bg-white/95 backdrop-blur-md border-t border-border-subtle p-4 text-center">
                  <p className="text-xs text-text-muted font-medium mb-2.5">
                    This consultation is closed. To chat with your doctor again, submit a new case.
                  </p>
                  <Link
                    href="/submit-case"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_circle</span>
                    <span>Submit a New Case</span>
                  </Link>
                </div>
              ) : (
                /* Thread Active Input Bar */
                <div className="sticky bottom-0 z-30 bg-white/95 backdrop-blur-md border-t border-border-subtle p-3 sm:p-4">
                  {/* Quick Clinical Chips */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
                    {QUICK_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => handleSendMessage(chip)}
                        className="px-2.5 py-1 rounded-full bg-surface-secondary hover:bg-accent/10 hover:text-accent border border-border-subtle text-[11px] text-text-muted font-medium whitespace-nowrap transition-all cursor-pointer shrink-0"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  {/* Textarea & Send Button */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 bg-surface-secondary/70 border border-border-subtle rounded-2xl p-2 focus-within:bg-white focus-within:border-accent transition-all">
                      <textarea
                        ref={textareaRef}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`Message ${doctorName}... (Press Enter to send)`}
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
                    Messages are encrypted and transmitted directly to your physician.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <BottomNav />

      {/* Photo Enlarge Modal */}
      {showPhotoModal && selectedCase?.photo_url && (
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
              src={selectedCase.photo_url}
              alt="Enlarged photo"
              className="w-full h-auto rounded-xl border border-border-subtle"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="text-text-muted text-xs">Loading messages...</p>
        </div>
      }
    >
      <MessagesContent />
    </Suspense>
  )
}
