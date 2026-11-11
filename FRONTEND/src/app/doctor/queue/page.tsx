'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'

type CaseItem = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
  created_at: string
  patient_id: string
  doctor_id: string | null
  patient_name: string
  category: string
  clean_description: string
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
    label: 'Routine Concern',
    badge: 'bg-surface-secondary text-text-muted border-border-subtle',
    dot: 'bg-gray-400',
  },
}

const statusStyles: Record<string, string> = {
  pending: 'bg-surface-secondary text-primary border-border-subtle',
  in_review: 'bg-amber-50 text-amber-800 border-amber-200',
  responded: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  closed: 'bg-gray-100 text-gray-500 border-gray-200',
}

const tabOptions = [
  { label: 'All Notes', value: 'all' },
  { label: 'Needs Response', value: 'pending' },
  { label: 'In Review', value: 'in_review' },
  { label: 'Responded', value: 'responded' },
]

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

import { computeCaseSLA, type CaseSLAInfo } from '@/lib/sla'
export { computeCaseSLA, type CaseSLAInfo }


export default function DoctorQueuePage() {
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [urgencyFilter, setUrgencyFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const router = useRouter()

  useEffect(() => {
    const loadQueueData = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

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
      setSpecialty(profile.specialty || '')
      setDoctorId(user.id)

      // Fetch enrolled patient IDs for this doctor
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

      // Query cases assigned to doctor OR from doctor's enrolled patients
      let casesQuery = supabase
        .from('cases')
        .select('id, symptoms_description, photo_url, urgency, status, created_at, patient_id, doctor_id')
        .order('created_at', { ascending: false })

      if (enrolledPatientIds.length > 0) {
        casesQuery = casesQuery.or(`doctor_id.eq.${user.id},patient_id.in.(${enrolledPatientIds.join(',')})`)
      } else {
        casesQuery = casesQuery.eq('doctor_id', user.id)
      }

      const { data: casesData, error: casesError } = await casesQuery

      if (casesData && !casesError) {
        const patientIds = Array.from(new Set(casesData.map((c) => c.patient_id).filter(Boolean)))

        let profileMap: Record<string, string> = {}
        if (patientIds.length > 0) {
          const { data: patientProfiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', patientIds)

          if (patientProfiles) {
            patientProfiles.forEach((p) => {
              profileMap[p.id] = p.full_name
            })
          }
        }

        const enrichedCases = casesData.map((c) => {
          const rawDesc = c.symptoms_description || ''
          const match = rawDesc.match(/^\[Category:\s*([^\]]+)\]\s*([\s\S]*)$/i)
          const category = match ? match[1].trim() : 'Follow-Up Concern'
          const cleanDescription = match ? match[2].trim() : rawDesc

          return {
            ...c,
            patient_name: profileMap[c.patient_id] || 'Enrolled Patient',
            category,
            clean_description: cleanDescription,
          }
        })

        setCases(enrichedCases)
      }

      setLoading(false)
    }

    loadQueueData()

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        loadQueueData()
      }
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [router])

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: cases.length,
      pending: 0,
      in_review: 0,
      responded: 0,
    }
    cases.forEach((item) => {
      if (c[item.status] !== undefined) {
        c[item.status]++
      }
    })
    return c
  }, [cases])

  const urgentCount = useMemo(() => {
    return cases.filter(
      (c) => (c.status === 'pending' || c.status === 'in_review') && c.urgency === 'needs_live_call'
    ).length
  }, [cases])

  const breachedCount = useMemo(() => {
    return cases.filter((c) => computeCaseSLA(c.urgency, c.created_at, c.status).isBreached).length
  }, [cases])

  const warningCount = useMemo(() => {
    return cases.filter((c) => computeCaseSLA(c.urgency, c.created_at, c.status).isWarning).length
  }, [cases])

  const filteredCases = useMemo(() => {
    let result = cases.filter((item) => {
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter
      const matchesUrgency = urgencyFilter === 'all' || item.urgency === urgencyFilter
      const query = searchQuery.toLowerCase().trim()
      const matchesSearch =
        !query ||
        item.clean_description.toLowerCase().includes(query) ||
        item.patient_name.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
      return matchesStatus && matchesUrgency && matchesSearch
    })

    return result
  }, [cases, statusFilter, urgencyFilter, searchQuery])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-text-muted font-medium">Loading follow-up notes...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="Case Queue" />
      <DoctorDesktopHeader fullName={fullName} />

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex flex-col pb-24 md:pb-12 pt-16 md:pt-0 transition-all duration-300 ease-in-out">
        <div className="max-w-[1020px] mx-auto w-full px-4 md:px-8 py-6 md:py-8 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-primary">
                  Patient Follow-Up Notes
                </h1>
                {urgentCount > 0 && (
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    {urgentCount} Priority
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                Review follow-up symptom notes, side effects, and recovery questions from your enrolled patients.
              </p>
            </div>

            <Link
              href="/doctor/dashboard"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-border-subtle hover:bg-surface-secondary text-primary font-bold text-xs rounded-xl transition-all shadow-2xs self-start sm:self-auto"
            >
              <span className="material-symbols-outlined text-[16px]">dashboard</span>
              <span>Doctor Dashboard</span>
            </Link>
          </div>

          {/* Quick Stat Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-xs">
              <span className="text-xs text-text-muted font-semibold">Total Follow-Ups</span>
              <p className="text-2xl font-bold text-primary mt-1">{counts.all}</p>
            </div>
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-xs">
              <span className="text-xs text-text-muted font-semibold">Needs Response</span>
              <p className="text-2xl font-bold text-accent mt-1">{counts.pending}</p>
            </div>
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-xs">
              <span className="text-xs text-text-muted font-semibold">In Review</span>
              <p className="text-2xl font-bold text-amber-700 mt-1">{counts.in_review}</p>
            </div>
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-xs">
              <span className="text-xs text-text-muted font-semibold">Resolved</span>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{counts.responded}</p>
            </div>
          </div>

          {/* Search, Status Tabs, and Filters */}
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by patient name, category, or symptoms..."
                  className="w-full bg-white border border-border-subtle rounded-xl pl-10 pr-10 py-2.5 text-xs text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors shadow-2xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary text-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">cancel</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-white border border-border-subtle rounded-xl px-3 py-2 text-xs shadow-2xs">
                  <span className="text-text-muted font-medium">Urgency:</span>
                  <select
                    value={urgencyFilter}
                    onChange={(e) => setUrgencyFilter(e.target.value)}
                    className="bg-transparent text-primary font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="all">All</option>
                    <option value="needs_live_call">Priority</option>
                    <option value="somewhat_urgent">Needs Attention</option>
                    <option value="routine">Routine</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {tabOptions.map((tab) => {
                const count = counts[tab.value] || 0
                const isSelected = statusFilter === tab.value
                return (
                  <button
                    key={tab.value}
                    onClick={() => setStatusFilter(tab.value)}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-accent text-white border-accent shadow-xs'
                        : 'bg-white text-text-muted border-border-subtle hover:border-accent/40'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-surface-secondary text-text-muted'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* SLA Escalation Warning Banner */}
          {breachedCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0 shadow-2xs">
                  <span className="material-symbols-outlined text-[20px] animate-pulse">crisis_alert</span>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-red-800 uppercase tracking-wider">
                    {breachedCount} Patient Consultation{breachedCount > 1 ? 's' : ''} Exceeded Response SLA
                  </h4>
                  <p className="text-xs text-red-900 mt-0.5 font-medium leading-relaxed">
                    Cases highlighted below have passed their clinical review target. Prompt physician reply or on-call reassignment is urgently recommended.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Notes Feed */}
          {filteredCases.length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-2xl p-12 text-center text-text-muted space-y-2 shadow-xs">
              <span className="material-symbols-outlined text-4xl text-text-muted/40">inbox</span>
              <p className="font-bold text-sm text-primary">No follow-up notes found</p>
              <p className="text-xs text-text-muted">
                {searchQuery || statusFilter !== 'all' || urgencyFilter !== 'all'
                  ? 'Try adjusting your search or filters.'
                  : 'All patient questions and recovery updates have been addressed.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCases.map((c) => {
                const urgency = urgencyConfig[c.urgency] || {
                  label: c.urgency,
                  badge: 'bg-surface-secondary text-text-muted border-border-subtle',
                  dot: 'bg-gray-400',
                }
                const sla = computeCaseSLA(c.urgency, c.created_at, c.status)

                return (
                  <Link
                    key={c.id}
                    href={`/doctor/case/${c.id}`}
                    className={`block rounded-2xl p-4 md:p-5 shadow-xs transition-all group cursor-pointer ${
                      sla.isBreached
                        ? 'bg-red-50/30 border-2 border-red-300 hover:border-red-500'
                        : sla.isWarning
                        ? 'bg-amber-50/20 border-2 border-amber-300 hover:border-amber-500'
                        : 'bg-white border border-border-subtle hover:border-accent/60'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                          {c.patient_name}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-bold">
                          {c.category}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${urgency.badge}`}>
                          {urgency.label}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold capitalize ${statusStyles[c.status] || statusStyles.pending}`}>
                          {c.status.replace('_', ' ')}
                        </span>

                        {/* SLA Indicator Badge */}
                        {sla.isBreached ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-300 bg-red-100 text-red-800 font-bold flex items-center gap-1 animate-pulse">
                            <span className="material-symbols-outlined text-[12px]">emergency</span>
                            ESCALATED • SLA Breached ({sla.overdueStr})
                          </span>
                        ) : sla.isWarning ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-300 bg-amber-100 text-amber-900 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">timer</span>
                            SLA Warning ({sla.timeRemainingStr})
                          </span>
                        ) : c.status === 'responded' || c.status === 'closed' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">check</span>
                            SLA Met
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border-subtle bg-surface-secondary text-text-muted font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">schedule</span>
                            {sla.slaLabel} • {sla.timeRemainingStr}
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] text-text-muted font-mono self-start sm:self-auto">
                        {timeAgo(c.created_at)}
                      </span>
                    </div>

                    <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">
                      {c.clean_description}
                    </p>

                    {c.photo_url && (
                      <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] text-accent font-semibold">
                        <span className="material-symbols-outlined text-[14px]">image</span>
                        <span>Attached Photo</span>
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <DoctorBottomNav activePage="Follow-Up Notes" />
    </div>
  )
}
