'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'

type CaseItem = {
  id: string
  symptoms_description: string
  photo_url: string | null
  urgency: string
  status: string
  target_response_by: string | null
  created_at: string
}

const statusStyles: Record<string, string> = {
  pending: 'bg-surface-secondary text-primary',
  in_review: 'bg-[#FFF4E5] text-[#B26B00]',
  responded: 'bg-[#E8F5E9] text-[#2E7D32]',
  closed: 'bg-gray-100 text-gray-500',
}

const urgencyLabels: Record<string, { label: string; dot: string }> = {
  routine: { label: 'Routine', dot: 'bg-gray-400' },
  somewhat_urgent: { label: 'Somewhat Urgent', dot: 'bg-orange-500' },
  needs_live_call: { label: 'Needs Live Call', dot: 'bg-red-600' },
}

const filterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'In Review', value: 'in_review' },
  { label: 'Responded', value: 'responded' },
  { label: 'Closed', value: 'closed' },
]

export default function CasesPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const router = useRouter()

  useEffect(() => {
    const loadCases = async () => {
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

      const { data: casesData, error: casesError } = await supabase
        .from('cases')
        .select('id, symptoms_description, photo_url, urgency, status, target_response_by, created_at')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false })

      if (casesData && !casesError) {
        setCases(casesData)
      }

      setLoading(false)
    }

    loadCases()
  }, [router])

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: cases.length,
      pending: 0,
      in_review: 0,
      responded: 0,
      closed: 0,
    }
    cases.forEach((item) => {
      if (c[item.status] !== undefined) {
        c[item.status]++
      }
    })
    return c
  }, [cases])

  const filteredCases = useMemo(() => {
    return cases.filter((item) => {
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter
      const matchesSearch =
        searchQuery.trim() === '' ||
        item.symptoms_description.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesStatus && matchesSearch
    })
  }, [cases, statusFilter, searchQuery])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-text-muted text-sm">Loading cases...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar fullName={fullName} email={email} activePage="My Cases" />
      <DesktopHeader />
      <TopBar />

      <main className="md:ml-64 flex flex-col pb-24 md:pb-8">
        <div className="max-w-[960px] mx-auto w-full px-4 md:px-8 py-6 md:py-10 flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-primary">My Cases &amp; Consultations</h1>
              <p className="text-xs md:text-sm text-text-muted mt-1">
                Review submitted questions, symptom logs, and notes sent to your doctor. Once a doctor responds, an interactive chat unlocks in Messages.
              </p>
            </div>
            <Link
              href="/submit-case"
              className="inline-flex items-center justify-center gap-2 bg-accent text-white font-bold text-xs px-4 py-2.5 rounded-xl hover:bg-[#0c704d] transition-colors self-start sm:self-auto shrink-0 shadow-xs"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>Submit a Concern</span>
            </Link>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col gap-4">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-[20px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cases by symptom..."
                className="w-full bg-white border border-border-subtle rounded-lg pl-10 pr-4 py-2.5 text-sm text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-0 transition-colors"
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

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {filterOptions.map((opt) => {
                const count = counts[opt.value] || 0
                const isSelected = statusFilter === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${isSelected
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-text-muted border-border-subtle hover:border-primary/40'
                      }`}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-surface-secondary text-text-muted'
                        }`}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cases List */}
          {cases.length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-lg p-10 flex flex-col items-center justify-center text-center">
              <span className="material-symbols-outlined text-text-muted text-5xl mb-3">folder_open</span>
              <h3 className="text-base font-semibold text-primary mb-1">No cases submitted yet</h3>
              <p className="text-sm text-text-muted mb-6 max-w-md">
                When you submit symptoms or request medical review, your cases and doctor responses will appear here.
              </p>
              <Link
                href="/submit-case"
                className="inline-flex items-center gap-2 bg-accent text-white font-semibold text-sm px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Submit Your First Case
              </Link>
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-lg p-10 flex flex-col items-center justify-center text-center">
              <span className="material-symbols-outlined text-text-muted text-4xl mb-2">search_off</span>
              <p className="text-base font-medium text-primary mb-1">No matching cases found</p>
              <p className="text-sm text-text-muted mb-4">
                Try adjusting your search query or status filter.
              </p>
              <button
                onClick={() => {
                  setStatusFilter('all')
                  setSearchQuery('')
                }}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredCases.map((c) => {
                const urgencyInfo = urgencyLabels[c.urgency] || {
                  label: c.urgency.replace('_', ' '),
                  dot: 'bg-gray-400',
                }

                return (
                  <Link
                    key={c.id}
                    href={`/cases/${c.id}`}
                    className="group bg-white border border-border-subtle hover:border-primary/50 hover:shadow-sm rounded-lg p-5 transition-all flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-medium px-2.5 py-0.5 rounded capitalize ${statusStyles[c.status] || statusStyles.pending
                            }`}
                        >
                          {c.status.replace('_', ' ')}
                        </span>
                        <div className="flex items-center gap-1.5 bg-surface-secondary px-2.5 py-0.5 rounded text-xs text-text-muted capitalize">
                          <span className={`w-2 h-2 rounded-full ${urgencyInfo.dot}`} />
                          <span>{urgencyInfo.label}</span>
                        </div>
                        {c.photo_url && (
                          <div className="flex items-center gap-1 text-xs text-text-muted bg-surface-secondary px-2 py-0.5 rounded">
                            <span className="material-symbols-outlined text-[14px]">image</span>
                            <span>Photo attached</span>
                          </div>
                        )}
                      </div>

                      <span className="text-xs text-text-muted shrink-0">
                        {new Date(c.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>

                    <p className="text-sm text-primary font-medium line-clamp-2 leading-relaxed group-hover:text-accent transition-colors">
                      {c.symptoms_description}
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-border-subtle text-xs text-text-muted mt-1">
                      {c.status === 'closed' || c.status === 'resolved' ? (
                        <div className="flex items-center gap-1.5 text-text-muted font-medium">
                          <span className="material-symbols-outlined text-[15px]">task_alt</span>
                          <span>Case Solved &bull; Thread Closed</span>
                        </div>
                      ) : c.status === 'responded' ? (
                        <div className="flex items-center gap-1.5 text-accent font-medium">
                          <span className="material-symbols-outlined text-[15px]">chat</span>
                          <span>Doctor Responded &bull; Chat Active in Messages</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[15px] text-accent">schedule</span>
                          <span>
                            Target response:{' '}
                            <strong className="text-primary font-medium">
                              {c.target_response_by
                                ? new Date(c.target_response_by).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })
                                : 'Pending Doctor Review'}
                            </strong>
                          </span>
                        </div>
                      )}

                      <span className="inline-flex items-center gap-1 text-primary group-hover:text-accent font-semibold transition-colors">
                        View details
                        <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">
                          arrow_forward
                        </span>
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  )
}
