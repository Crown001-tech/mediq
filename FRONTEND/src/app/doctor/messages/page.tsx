'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'

type CaseConversation = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
  created_at: string
  patient_id: string
  patient_name: string
  patient_gender: string | null
  patient_age: number | null
  last_message?: string
  last_message_at?: string
}

const urgencyLabels: Record<string, { label: string; badge: string }> = {
  needs_live_call: { label: 'Priority Review', badge: 'bg-red-50 text-red-700 border-red-200' },
  somewhat_urgent: { label: 'Needs Attention', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  routine: { label: 'Routine Follow-Up', badge: 'bg-surface-secondary text-text-muted border-border-subtle' },
}

export default function DoctorMessagesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [conversations, setConversations] = useState<CaseConversation[]>([])
  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const loadDoctorConversations = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, specialty, role')
        .eq('id', user.id)
        .maybeSingle()

      if (profile) {
        setFullName(profile.full_name || 'Dr. Physician')
        setSpecialty(profile.specialty || 'General Practitioner')
      }

      // Fetch cases assigned to doctor OR from doctor's enrolled patients
      let enrolledPatientIds: string[] = []
      const { data: activeEnrollments } = await supabase
        .from('enrollments')
        .select('patient_id')
        .eq('doctor_id', user.id)
        .eq('status', 'active')
        .not('patient_id', 'is', null)

      if (activeEnrollments) {
        enrolledPatientIds = activeEnrollments.map((e) => e.patient_id).filter(Boolean)
      }

      let casesQuery = supabase
        .from('cases')
        .select('id, symptoms_description, photo_url, urgency, status, created_at, patient_id')
        .order('created_at', { ascending: false })

      if (enrolledPatientIds.length > 0) {
        casesQuery = casesQuery.or(`doctor_id.eq.${user.id},patient_id.in.(${enrolledPatientIds.join(',')})`)
      } else {
        casesQuery = casesQuery.eq('doctor_id', user.id)
      }

      const { data: casesData } = await casesQuery

      if (casesData && casesData.length > 0) {
        // Collect patient profiles
        const patientIds = Array.from(new Set(casesData.map((c) => c.patient_id).filter(Boolean)))
        const { data: patients } = await supabase
          .from('profiles')
          .select('id, full_name, gender, date_of_birth')
          .in('id', patientIds)

        const patientMap = new Map((patients || []).map((p) => [p.id, p]))

        const mapped: CaseConversation[] = casesData.map((c) => {
          const pat = patientMap.get(c.patient_id)
          let age: number | null = null
          if (pat?.date_of_birth) {
            const birth = new Date(pat.date_of_birth)
            const diff = Date.now() - birth.getTime()
            age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000))
          }

          // Check for any cached local chat messages
          let lastMsg = ''
          let lastMsgAt = c.created_at
          try {
            const cached = localStorage.getItem(`mediq_chat_${c.id}`)
            if (cached) {
              const msgs = JSON.parse(cached)
              if (msgs.length > 0) {
                const latest = msgs[msgs.length - 1]
                lastMsg = latest.message
                lastMsgAt = latest.createdAt
              }
            }
          } catch {
            // Ignore
          }

          return {
            id: c.id,
            symptoms_description: c.symptoms_description,
            photo_url: c.photo_url,
            urgency: c.urgency,
            status: c.status,
            created_at: c.created_at,
            patient_id: c.patient_id,
            patient_name: pat?.full_name || 'Patient',
            patient_gender: pat?.gender || null,
            patient_age: age,
            last_message: lastMsg || c.symptoms_description,
            last_message_at: lastMsgAt,
          }
        })

        // Sort by most recent activity
        mapped.sort((a, b) => new Date(b.last_message_at || b.created_at).getTime() - new Date(a.last_message_at || a.created_at).getTime())
        setConversations(mapped)
      }

      setLoading(false)
    }

    loadDoctorConversations()
  }, [router])

  const activeConversations = useMemo(() => {
    return conversations.filter((c) => c.status !== 'closed' && c.status !== 'resolved')
  }, [conversations])

  const closedConversations = useMemo(() => {
    return conversations.filter((c) => c.status === 'closed' || c.status === 'resolved')
  }, [conversations])

  const displayedList = useMemo(() => {
    const list = activeTab === 'active' ? activeConversations : closedConversations
    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase()
    return list.filter(
      (c) =>
        c.patient_name.toLowerCase().includes(q) ||
        c.symptoms_description.toLowerCase().includes(q)
    )
  }, [activeTab, activeConversations, closedConversations, searchQuery])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted text-xs font-semibold">Loading clinical messages...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="Messages" />
      <DoctorDesktopHeader fullName={fullName} specialty={specialty} />

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex-1 flex flex-col pb-24 md:pb-8 transition-all duration-300 ease-in-out">
        <div className="max-w-4xl mx-auto w-full px-4 md:px-8 py-6 md:py-8 flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-primary">Patient Messages &amp; Discussions</h1>
              <p className="text-xs md:text-sm text-text-muted mt-1">
                Active real-time conversation threads with your patients. Threads close once you mark the case as resolved.
              </p>
            </div>
            <Link
              href="/doctor/queue"
              className="inline-flex items-center gap-2 bg-accent text-white font-bold text-xs px-4 py-2.5 rounded-xl hover:bg-accent/90 transition-all self-start sm:self-auto shadow-xs"
            >
              <span className="material-symbols-outlined text-[16px]">pending_actions</span>
              <span>Review Case Queue</span>
            </Link>
          </div>

          {/* Search & Tabs */}
          <div className="flex flex-col gap-3">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-[20px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages by patient name or symptoms..."
                className="w-full bg-white border border-border-subtle rounded-xl pl-10 pr-4 py-2.5 text-xs sm:text-sm text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors shadow-2xs"
              />
            </div>

            {/* Segmented Filter Tabs */}
            <div className="flex items-center gap-2 border-b border-border-subtle pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'active'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-white text-text-muted border border-border-subtle hover:text-primary'
                }`}
              >
                <span>Active Discussions</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'active' ? 'bg-white/20 text-white' : 'bg-surface-secondary text-text-muted'}`}>
                  {activeConversations.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('closed')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'closed'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-white text-text-muted border border-border-subtle hover:text-primary'
                }`}
              >
                <span>Solved &amp; Closed Cases</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'closed' ? 'bg-white/20 text-white' : 'bg-surface-secondary text-text-muted'}`}>
                  {closedConversations.length}
                </span>
              </button>
            </div>
          </div>

          {/* Conversations List */}
          {displayedList.length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-2xl p-10 flex flex-col items-center justify-center text-center shadow-xs">
              <div className="w-14 h-14 rounded-full bg-surface-secondary flex items-center justify-center text-text-muted mb-3">
                <span className="material-symbols-outlined text-3xl">chat</span>
              </div>
              <h3 className="text-sm font-bold text-primary mb-1">
                {activeTab === 'active' ? 'No active patient discussions' : 'No resolved cases yet'}
              </h3>
              <p className="text-xs text-text-muted max-w-sm mb-5 leading-relaxed">
                {activeTab === 'active'
                  ? 'When you review and respond to patient cases in your triage queue, active messaging threads will appear here.'
                  : 'Cases that you mark as solved and closed will be archived here for clinical reference.'}
              </p>
              {activeTab === 'active' && (
                <Link
                  href="/doctor/queue"
                  className="px-4 py-2 bg-accent text-white rounded-xl text-xs font-bold hover:bg-accent/90 transition-all shadow-2xs"
                >
                  Go to Triage Queue
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {displayedList.map((conv) => {
                const urgency = urgencyLabels[conv.urgency] || urgencyLabels.routine
                const isClosed = conv.status === 'closed' || conv.status === 'resolved'

                return (
                  <Link
                    key={conv.id}
                    href={`/doctor/case/${conv.id}`}
                    className="group bg-white border border-border-subtle hover:border-accent hover:shadow-sm rounded-2xl p-4 sm:p-5 transition-all flex flex-col gap-3 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-sm shadow-2xs shrink-0">
                          {conv.patient_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                              {conv.patient_name}
                            </h3>
                            <span className={`px-2 py-0.2 rounded-full text-[10px] font-bold border ${urgency.badge}`}>
                              {urgency.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted mt-0.5">
                            {conv.patient_gender || 'Patient'}
                            {conv.patient_age !== null ? ` • ${conv.patient_age} yrs` : ''}
                            {' • '}Case #{conv.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] text-text-muted font-mono">
                          {new Date(conv.last_message_at || conv.created_at).toLocaleDateString()}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                            isClosed
                              ? 'bg-gray-100 text-gray-600 border border-gray-200'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {isClosed ? 'Case Solved • Closed' : 'Active Discussion'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-surface-secondary/50 rounded-xl p-2.5 border border-border-subtle/60 flex items-center justify-between gap-3">
                      <p className="text-xs text-primary/80 line-clamp-1 flex-1">
                        <strong className="text-primary font-semibold">Latest: </strong>
                        {conv.last_message || conv.symptoms_description}
                      </p>
                      <span className="material-symbols-outlined text-[16px] text-text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0">
                        arrow_forward
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <DoctorBottomNav activePage="Messages" />
    </div>
  )
}
