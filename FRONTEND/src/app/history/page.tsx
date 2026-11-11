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

type HistoricalCase = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
  created_at: string
  doctor_id: string | null
  doctor_name?: string
  doctor_specialty?: string
  last_message?: string | null
  has_prescription?: boolean
}

type PastCarePlan = {
  id: string
  type: string
  details: string
  schedule: string
  created_at: string
  active: boolean
}

const statusBadgeStyles: Record<string, { label: string; badge: string }> = {
  closed: { label: 'Resolved & Closed', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  responded: { label: 'Completed Review', badge: 'bg-blue-50 text-blue-800 border-blue-200' },
  in_review: { label: 'Under Review', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  pending: { label: 'Pending Response', badge: 'bg-surface-secondary text-primary border-border-subtle' },
}

const urgencyLabels: Record<string, { label: string; dot: string }> = {
  routine: { label: 'Routine Encounter', dot: 'bg-emerald-500' },
  somewhat_urgent: { label: 'Moderate Priority', dot: 'bg-amber-500' },
  needs_live_call: { label: 'Live Telehealth Consult', dot: 'bg-red-500' },
}

export default function HistoryPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [cases, setCases] = useState<HistoricalCase[]>([])
  const [pastCarePlans, setPastCarePlans] = useState<PastCarePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'closed' | 'responded'>('all')
  const [timeframe, setTimeframe] = useState<'all' | '30d' | '90d' | 'year'>('all')

  const router = useRouter()

  useEffect(() => {
    const loadHistory = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setEmail(user.email || '')

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle()

      if (profile?.full_name) {
        setFullName(profile.full_name)
      }

      // 1. Fetch cases
      const { data: casesData } = await supabase
        .from('cases')
        .select('id, symptoms_description, photo_url, urgency, status, created_at, doctor_id')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false })

      // 2. Fetch completed/archived care plans
      const { data: plansData } = await supabase
        .from('care_plans')
        .select('id, type, details, schedule, created_at, active')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false })

      if (plansData) {
        setPastCarePlans(plansData)
      }

      if (casesData && casesData.length > 0) {
        // Collect doctor IDs to fetch doctor profiles
        const doctorIds = [...new Set(casesData.map((c) => c.doctor_id).filter(Boolean))] as string[]
        const docMap: Record<string, { name: string; specialty: string }> = {}

        if (doctorIds.length > 0) {
          const { data: docProfiles } = await supabase
            .from('profiles')
            .select('id, full_name, specialty')
            .in('id', doctorIds)

          if (docProfiles) {
            docProfiles.forEach((d) => {
              docMap[d.id] = {
                name: d.full_name || 'Attending Physician',
                specialty: d.specialty || 'General Practice',
              }
            })
          }
        }

        // Check for case messages/prescriptions in local fallback if any
        let localNotesMap: Record<string, string> = {}
        try {
          const storedNotes = localStorage.getItem('mediq_doctor_notes')
          if (storedNotes) {
            localNotesMap = JSON.parse(storedNotes)
          }
        } catch {}

        setCases(
          casesData.map((c) => {
            const docInfo = c.doctor_id ? docMap[c.doctor_id] : null
            return {
              ...c,
              doctor_name: docInfo ? formatDoctorName(docInfo.name) : 'Attending Physician',
              doctor_specialty: docInfo?.specialty || 'General Practice',
              last_message: localNotesMap[c.id] || null,
              has_prescription: localNotesMap[c.id]?.toLowerCase().includes('prescri') || false,
            }
          })
        )
      }

      setLoading(false)
    }

    loadHistory()
  }, [router])

  // Filter cases by search, status, and timeframe
  const filteredCases = useMemo(() => {
    const now = Date.now()
    return cases.filter((c) => {
      // Status filter
      if (statusFilter === 'closed' && c.status !== 'closed') return false
      if (statusFilter === 'responded' && c.status !== 'responded' && c.status !== 'closed') return false

      // Timeframe filter
      const caseTime = new Date(c.created_at).getTime()
      if (timeframe === '30d' && now - caseTime > 30 * 24 * 60 * 60 * 1000) return false
      if (timeframe === '90d' && now - caseTime > 90 * 24 * 60 * 60 * 1000) return false
      if (timeframe === 'year' && now - caseTime > 365 * 24 * 60 * 60 * 1000) return false

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchSymptoms = c.symptoms_description?.toLowerCase().includes(q)
        const matchDoctor = c.doctor_name?.toLowerCase().includes(q)
        const matchSpecialty = c.doctor_specialty?.toLowerCase().includes(q)
        return matchSymptoms || matchDoctor || matchSpecialty
      }

      return true
    })
  }, [cases, statusFilter, timeframe, searchQuery])

  // Aggregate metrics
  const totalEncounters = cases.length
  const resolvedCount = cases.filter((c) => c.status === 'closed' || c.status === 'responded').length
  const completedPlansCount = pastCarePlans.filter((p) => !p.active).length

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-text-muted">Loading your Case History...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="Case History" />
      <TopBar />
      <DesktopHeader />

      <main className="md:ml-64 flex flex-col pb-24 md:pb-12 pt-16 md:pt-0">
        <div className="max-w-[960px] mx-auto w-full px-4 md:px-8 py-6 md:py-10 flex flex-col gap-8">
          {/* Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-subtle">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[24px]">history</span>
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-primary">Case History &amp; Records</h1>
                  <p className="text-xs md:text-sm text-text-muted mt-0.5">
                    Your complete archive of past medical consultations, clinical assessments, and treatment plans.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-start sm:self-center">
              <Link
                href="/appointments"
                className="bg-white border border-border-subtle hover:bg-surface-secondary text-primary px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-2xs"
              >
                <span className="material-symbols-outlined text-accent text-[18px]">calendar_month</span>
                <span>Appointments</span>
              </Link>
              <Link
                href="/submit-case"
                className="bg-accent hover:bg-[#0c704d] text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>New Consultation</span>
              </Link>
            </div>
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Total Encounters</span>
                <span className="material-symbols-outlined text-accent text-[18px]">folder_shared</span>
              </div>
              <p className="text-2xl font-bold text-primary">{totalEncounters}</p>
              <p className="text-[10px] text-text-muted mt-1">Recorded consultations</p>
            </div>

            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Resolved Cases</span>
                <span className="material-symbols-outlined text-emerald-600 text-[18px]">check_circle</span>
              </div>
              <p className="text-2xl font-bold text-emerald-700">{resolvedCount}</p>
              <p className="text-[10px] text-text-muted mt-1">Completed reviews</p>
            </div>

            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Care Milestones</span>
                <span className="material-symbols-outlined text-teal-600 text-[18px]">assignment_turned_in</span>
              </div>
              <p className="text-2xl font-bold text-primary">{pastCarePlans.length}</p>
              <p className="text-[10px] text-text-muted mt-1">Prescription protocols</p>
            </div>

            <div className="bg-white border border-border-subtle rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider">Status</span>
                <span className="material-symbols-outlined text-accent text-[18px]">verified</span>
              </div>
              <p className="text-sm font-bold text-accent truncate">Active Patient</p>
              <p className="text-[10px] text-text-muted mt-1">Records synced &amp; verified</p>
            </div>
          </div>

          {/* Search & Filter Controls */}
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
                placeholder="Search past symptoms, diagnoses, or doctor name..."
                className="w-full bg-surface-secondary/60 border border-border-subtle rounded-xl pl-10 pr-4 py-2 text-xs text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary text-xs"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
              <div className="flex items-center bg-surface-secondary p-1 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    statusFilter === 'all'
                      ? 'bg-white text-primary shadow-2xs font-bold'
                      : 'text-text-muted hover:text-primary'
                  }`}
                >
                  All ({cases.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('closed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    statusFilter === 'closed'
                      ? 'bg-white text-primary shadow-2xs font-bold'
                      : 'text-text-muted hover:text-primary'
                  }`}
                >
                  Resolved
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('responded')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    statusFilter === 'responded'
                      ? 'bg-white text-primary shadow-2xs font-bold'
                      : 'text-text-muted hover:text-primary'
                  }`}
                >
                  Responded
                </button>
              </div>

              {/* Timeframe Dropdown */}
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as any)}
                aria-label="Filter case history by timeframe"
                className="bg-white border border-border-subtle rounded-xl px-3 py-2 text-xs font-semibold text-primary focus:outline-none focus:border-accent shrink-0 cursor-pointer"
              >
                <option value="all">All Time</option>
                <option value="30d">Past 30 Days</option>
                <option value="90d">Past 90 Days</option>
                <option value="year">This Past Year</option>
              </select>
            </div>
          </div>

          {/* Cases Encounter List */}
          {filteredCases.length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-2xs">
              <div className="w-16 h-16 rounded-full bg-surface-secondary text-text-muted flex items-center justify-center mb-3">
                <span className="material-symbols-outlined text-[32px]">manage_search</span>
              </div>
              <h3 className="text-base font-bold text-primary mb-1">
                {cases.length === 0 ? 'No Past Encounters Recorded' : 'No Matching Cases Found'}
              </h3>
              <p className="text-xs text-text-muted max-w-sm leading-relaxed mb-6">
                {cases.length === 0
                  ? 'Your completed doctor consultations, prescriptions, and medical discussions will be archived here for easy reference.'
                  : 'Try clearing your search query or adjusting the filters above to find earlier clinical records.'}
              </p>
              {cases.length === 0 ? (
                <Link
                  href="/submit-case"
                  className="px-5 py-2.5 bg-accent hover:bg-[#0c704d] text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">add_circle</span>
                  <span>Start Your First Consultation</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                    setTimeframe('all')
                  }}
                  className="px-4 py-2 border border-border-subtle text-primary hover:bg-surface-secondary rounded-xl text-xs font-semibold transition-all"
                >
                  Reset All Filters
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-xs text-text-muted px-1">
                <span>
                  Showing {filteredCases.length} encounter{filteredCases.length !== 1 ? 's' : ''}
                </span>
                <span className="text-[11px]">Sorted chronologically (newest first)</span>
              </div>

              {filteredCases.map((c) => {
                const statusInfo = statusBadgeStyles[c.status] || statusBadgeStyles.pending
                const urgencyInfo = urgencyLabels[c.urgency] || urgencyLabels.routine
                const createdDate = new Date(c.created_at)

                return (
                  <article
                    key={c.id}
                    className="bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-2xs hover:border-accent/40 transition-all flex flex-col gap-4"
                  >
                    {/* Top Row: Date, Urgency dot, Status badge */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-border-subtle">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
                          <span className="material-symbols-outlined text-[16px] text-accent">event</span>
                          <span>
                            {createdDate.toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                        <span className="text-border-subtle">•</span>
                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                          <span className={`w-2 h-2 rounded-full ${urgencyInfo.dot}`} />
                          <span>{urgencyInfo.label}</span>
                        </div>
                      </div>

                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${statusInfo.badge}`}>
                        {statusInfo.label}
                      </span>
                    </div>

                    {/* Middle Section: Doctor & Symptoms */}
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-xs shrink-0">
                            <span className="material-symbols-outlined text-[18px]">stethoscope</span>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-primary">{c.doctor_name}</p>
                            <p className="text-[10px] text-text-muted">{c.doctor_specialty}</p>
                          </div>
                        </div>

                        <div className="bg-surface-secondary/70 rounded-xl p-3.5 border border-border-subtle">
                          <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                            Reported Symptoms &amp; Notes
                          </p>
                          <p className="text-xs text-primary leading-relaxed line-clamp-3">
                            {c.symptoms_description}
                          </p>
                        </div>

                        {c.last_message && (
                          <div className="bg-emerald-50/60 rounded-xl p-3 border border-emerald-200/50">
                            <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-0.5">
                              Doctor Assessment / Instructions
                            </p>
                            <p className="text-xs text-emerald-950 line-clamp-2 italic">
                              "{c.last_message}"
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-subtle">
                      <div className="flex items-center gap-2 text-[11px] text-text-muted font-mono">
                        <span>Case Ref: #{c.id.slice(0, 8).toUpperCase()}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/appointments`}
                          className="px-3 py-1.5 bg-white border border-border-subtle hover:bg-surface-secondary text-primary rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-[15px] text-accent">videocam</span>
                          <span>Book Follow-Up</span>
                        </Link>
                        <Link
                          href={`/cases/${c.id}`}
                          className="px-3.5 py-1.5 bg-accent hover:bg-[#0c704d] text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs"
                        >
                          <span>View Full Record</span>
                          <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                        </Link>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {/* Archived Care Plan History Section */}
          {pastCarePlans.length > 0 && (
            <div className="mt-4 pt-6 border-t border-border-subtle flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-accent text-[20px]">assignment_turned_in</span>
                  <h2 className="text-base font-bold text-primary">Archived Care Plan Milestones</h2>
                </div>
                <Link href="/care-plan" className="text-xs font-bold text-accent hover:underline flex items-center gap-1">
                  <span>View Current Plan</span>
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pastCarePlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="bg-white border border-border-subtle rounded-2xl p-5 shadow-2xs flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-secondary text-text-muted border border-border-subtle">
                          {plan.type === 'medication' ? 'Medication Regimen' : 'Check-In Protocol'}
                        </span>
                        <span className="text-[11px] text-text-muted font-mono">
                          {new Date(plan.created_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-primary leading-relaxed line-clamp-2">
                        {plan.details || 'Prescribed health recovery and adherence monitoring protocol.'}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
                      <span className="text-[11px] text-text-muted capitalize">Cadence: {plan.schedule}</span>
                      <Link
                        href="/care-plan"
                        className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
                      >
                        <span>Details</span>
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  )
}
