'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, clearAuthCookie } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications'
import { formatDoctorName } from '@/shared/utils'

type DoctorProfile = {
  id: string
  full_name: string
  specialty: string | null
  bio: string | null
  phone: string | null
  created_at: string
  verified: boolean
}

type PatientProfile = {
  id: string
  full_name: string
  phone: string | null
  date_of_birth: string | null
  age: number | null
  gender: string | null
  created_at: string
}

type CaseAuditItem = {
  id: string
  symptoms_description: string
  urgency: string
  status: string
  created_at: string
  patient_id: string
  doctor_id: string | null
}

type ReassignmentAuditItem = {
  id: string
  patient_id: string
  patient_name: string
  old_doctor_id: string | null
  old_doctor_name: string
  new_doctor_id: string
  new_doctor_name: string
  notes: string
  created_at: string
}

export default function AdminPage() {
  const [adminName, setAdminName] = useState('')
  const [doctors, setDoctors] = useState<DoctorProfile[]>([])
  const [patients, setPatients] = useState<PatientProfile[]>([])
  const [cases, setCases] = useState<CaseAuditItem[]>([])
  const [reassignmentHistory, setReassignmentHistory] = useState<ReassignmentAuditItem[]>([])
  const [activeTab, setActiveTab] = useState<'pending_docs' | 'verified_docs' | 'patients' | 'cases' | 'reassignments'>('pending_docs')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Patient Reassignment State
  const [patientDoctorMap, setPatientDoctorMap] = useState<Record<string, { doctorId: string; status: string }>>({})
  const [reassignPatient, setReassignPatient] = useState<PatientProfile | null>(null)
  const [selectedNewDoctorId, setSelectedNewDoctorId] = useState<string>('')
  const [handoverNotes, setHandoverNotes] = useState<string>('')
  const [reassignSubmitting, setReassignSubmitting] = useState<boolean>(false)

  // Real KPI Metrics
  const [stats, setStats] = useState({
    pendingDoctors: 0,
    verifiedDoctors: 0,
    totalPatients: 0,
    totalCases: 0,
    activeCarePlans: 0,
  })

  const router = useRouter()

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 4000)
  }

  const loadData = async () => {
    // 1. Fetch Real Doctors
    const { data: docData } = await supabase
      .from('profiles')
      .select('id, full_name, specialty, bio, phone, created_at, verified')
      .eq('role', 'doctor')
      .order('created_at', { ascending: false })

    if (docData) setDoctors(docData)

    // 2. Fetch Real Patients
    const { data: patData } = await supabase
      .from('profiles')
      .select('id, full_name, phone, date_of_birth, age, gender, created_at')
      .eq('role', 'patient')
      .order('created_at', { ascending: false })

    if (patData) setPatients(patData)

    // 3. Fetch Real Clinical Cases
    const { data: casesData } = await supabase
      .from('cases')
      .select('id, symptoms_description, urgency, status, created_at, patient_id, doctor_id')
      .order('created_at', { ascending: false })
      .limit(30)

    if (casesData) setCases(casesData)

    // 4. Fetch Real Active Care Plans Count
    const { count: carePlanCount } = await supabase
      .from('care_plans')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)

    // 5. Fetch Enrollments & Care Plans & Cases to map attending physician per patient
    const docMap: Record<string, { doctorId: string; status: string }> = {}

    // A. Check Cases (Admins always have full read access to clinical cases)
    if (casesData && casesData.length > 0) {
      for (const c of casesData) {
        if (c.patient_id && c.doctor_id && !docMap[c.patient_id]) {
          docMap[c.patient_id] = { doctorId: c.doctor_id, status: c.status === 'closed' ? 'completed' : 'active' }
        }
      }
    }

    // B. Check Care Plans (both active and inactive/discharged)
    try {
      const { data: cpData } = await supabase
        .from('care_plans')
        .select('patient_id, doctor_id, active')
        .order('created_at', { ascending: false })

      if (cpData) {
        for (const cp of cpData) {
          if (cp.patient_id && cp.doctor_id && !docMap[cp.patient_id]) {
            docMap[cp.patient_id] = { doctorId: cp.doctor_id, status: cp.active ? 'active' : 'completed' }
          }
        }
      }
    } catch {
      // Graceful fallback
    }

    // C. Check Enrollments
    try {
      const { data: enrollData } = await supabase
        .from('enrollments')
        .select('patient_id, doctor_id, status')
        .order('created_at', { ascending: false })

      if (enrollData) {
        for (const en of enrollData) {
          if (en.patient_id && en.doctor_id) {
            docMap[en.patient_id] = { doctorId: en.doctor_id, status: en.status || 'active' }
          }
        }
      }
    } catch {
      // Graceful fallback
    }

    // D. Fetch from server API endpoint to bypass client RLS restrictions
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const authHeaders: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}
      const res = await fetch('/api/admin/patient-assignments', { headers: authHeaders })
      if (res.ok) {
        const json = await res.json()
        if (json?.assignments) {
          for (const item of json.assignments) {
            if (item.patient_id && item.doctor_id) {
              docMap[item.patient_id] = { doctorId: item.doctor_id, status: item.status || 'active' }
            }
          }
        }
      }
    } catch {
      // Graceful fallback
    }

    setPatientDoctorMap(docMap)

    // Compute live stats
    const pendingDocs = docData ? docData.filter((d) => !d.verified).length : 0
    const verifiedDocs = docData ? docData.filter((d) => d.verified).length : 0
    const totalPats = patData ? patData.length : 0
    const totalCasesCount = casesData ? casesData.length : 0

    setStats({
      pendingDoctors: pendingDocs,
      verifiedDoctors: verifiedDocs,
      totalPatients: totalPats,
      totalCases: totalCasesCount,
      activeCarePlans: carePlanCount || 0,
    })

    // 6. Fetch reassignment audit history
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const authHeaders: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}
      const res = await fetch('/api/admin/reassign', { headers: authHeaders })
      if (res.ok) {
        const json = await res.json()
        if (json?.history) {
          setReassignmentHistory(json.history)
        }
      }
    } catch {}

    setLoading(false)
  }

  const handleExecuteReassignment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reassignPatient || !selectedNewDoctorId) return

    setReassignSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()
      if (!user) return

      const prevDocInfo = patientDoctorMap[reassignPatient.id]
      const oldDoctorId = prevDocInfo?.doctorId || null
      const oldDoctor = doctors.find((d) => d.id === oldDoctorId)
      const oldDoctorName = oldDoctor?.full_name
        ? formatDoctorName(oldDoctor.full_name)
        : 'Previous Physician'

      const newDoc = doctors.find((d) => d.id === selectedNewDoctorId)
      const newDocName = newDoc?.full_name
        ? formatDoctorName(newDoc.full_name)
        : 'Attending Physician'

      const trimmedNotes = handoverNotes.trim()

      // 1. Call server API (reassigns, notifies all 3 parties in database, logs audit)
      await fetch('/api/admin/reassign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          patientId: reassignPatient.id,
          newDoctorId: selectedNewDoctorId,
          oldDoctorId: oldDoctorId,
          adminId: user.id,
          handoverNotes: trimmedNotes,
          patientName: reassignPatient.full_name,
          newDoctorName: newDocName,
          oldDoctorName: oldDoctorName,
        }),
      })

      // 2. Client-side notification dispatch for immediate toast & store sync
      if (oldDoctorId && oldDoctorId !== selectedNewDoctorId) {
        await sendNotification({
          userId: oldDoctorId,
          message: `Patient ${reassignPatient.full_name} has been reassigned to ${newDocName}. Handover notes: ${
            trimmedNotes || 'No specific notes provided.'
          }`,
          type: 'handover',
        })
      }

      await sendNotification({
        userId: selectedNewDoctorId,
        message: `Patient ${reassignPatient.full_name} has been assigned to your clinical roster from ${oldDoctorName}. Handover notes: ${
          trimmedNotes || 'Clinical care transfer.'
        }`,
        type: 'assignment',
      })

      await sendNotification({
        userId: reassignPatient.id,
        message: `Your attending physician has been updated to ${newDocName}.${
          trimmedNotes ? ` Handover notes: ${trimmedNotes}` : ''
        }`,
        type: 'system',
      })

      showToast(
        `Successfully reassigned ${reassignPatient.full_name} to ${newDocName}. All 3 parties notified.`
      )

      // Optimistic update
      setPatientDoctorMap((prev) => ({
        ...prev,
        [reassignPatient.id]: { doctorId: selectedNewDoctorId, status: 'active' },
      }))

      setReassignPatient(null)
      setSelectedNewDoctorId('')
      setHandoverNotes('')
      await loadData()
    } catch (err: any) {
      console.error('Reassignment error:', err)
      showToast(`Error executing reassignment: ${err.message}`)
    } finally {
      setReassignSubmitting(false)
    }
  }

  useEffect(() => {
    const checkAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') {
        router.push('/login')
        return
      }

      setAdminName(profile.full_name || 'System Administrator')
      await loadData()
    }

    checkAccess()
  }, [router])

  const callVerifyDoctorApi = async (id: string, action: 'approve' | 'reject' | 'revoke') => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      throw new Error('Not authenticated')
    }

    const res = await fetch('/api/admin/verify-doctor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ doctorId: id, action }),
    })

    const json = await res.json()
    if (!res.ok) {
      throw new Error(json.error || 'Failed to update credentials')
    }
    return json
  }

  const handleApprove = async (id: string, name: string) => {
    setActioningId(id)
    try {
      await callVerifyDoctorApi(id, 'approve')
      showToast(`Approved ${name}. Doctor can now access clinical hub.`)
      await loadData()
    } catch (err: any) {
      showToast(`Error: ${err.message}`)
    } finally {
      setActioningId(null)
    }
  }

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Revoke verified clinical status for ${name}?`)) return
    setActioningId(id)
    try {
      await callVerifyDoctorApi(id, 'revoke')
      showToast(`Revoked verification for ${name}.`)
      await loadData()
    } catch (err: any) {
      showToast(`Error: ${err.message}`)
    } finally {
      setActioningId(null)
    }
  }

  const handleReject = async (id: string, name: string) => {
    if (!confirm(`Reject medical staff application for ${name}? The applicant will be notified of their rejection upon logging in.`)) return
    setActioningId(id)
    try {
      await callVerifyDoctorApi(id, 'reject')
      showToast(`Application for ${name} has been rejected.`)
      await loadData()
    } catch (err: any) {
      showToast(`Error: ${err.message}`)
    } finally {
      setActioningId(null)
    }
  }

  const handleSignOut = async () => {
    clearAuthCookie()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Filtered lists based on search
  const pendingDoctorsList = useMemo(() => {
    const q = search.toLowerCase().trim()
    return doctors
      .filter((d) => !d.verified)
      .filter((d) => !q || d.full_name.toLowerCase().includes(q) || (d.specialty && d.specialty.toLowerCase().includes(q)))
  }, [doctors, search])

  const verifiedDoctorsList = useMemo(() => {
    const q = search.toLowerCase().trim()
    return doctors
      .filter((d) => d.verified)
      .filter((d) => !q || d.full_name.toLowerCase().includes(q) || (d.specialty && d.specialty.toLowerCase().includes(q)))
  }, [doctors, search])

  const patientsList = useMemo(() => {
    const q = search.toLowerCase().trim()
    return patients.filter((p) => !q || p.full_name.toLowerCase().includes(q) || (p.phone && p.phone.includes(q)))
  }, [patients, search])

  const casesList = useMemo(() => {
    const q = search.toLowerCase().trim()
    return cases.filter((c) => !q || c.symptoms_description.toLowerCase().includes(q) || c.status.toLowerCase().includes(q))
  }, [cases, search])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Loading Hospital Directorate Console...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      {/* ── Top Executive Header ────────────────────────────── */}
      <header className="bg-white border-b border-border-subtle sticky top-0 z-30 shadow-xs">
        <div className="max-w-[1200px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center font-bold text-base shadow-xs">
              M
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-primary">MEDIQ</span>
                <span className="text-[10px] bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                  DIRECTORATE ADMIN
                </span>
              </div>
              <p className="text-[10px] text-text-muted hidden sm:block">
                Hospital Clinical Governance &amp; Credentialing Console
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-text-muted hidden md:inline-block">
              Admin: <strong className="text-primary">{adminName}</strong>
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3 py-1.5 border border-border-subtle rounded-lg text-xs font-semibold text-text-muted hover:text-red-600 hover:bg-red-50 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">logout</span>
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#111111] text-white px-4 py-3 rounded-xl shadow-lg border border-white/10 text-xs font-semibold flex items-center gap-2 animate-fade-in">
          <span className="material-symbols-outlined text-accent text-[18px]">info</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── Main Executive Console ─────────────────────────── */}
      <main className="max-w-[1200px] mx-auto px-4 md:px-8 py-8">
        {/* Page Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-primary tracking-tight">Clinical Governance &amp; Directory</h1>
            <p className="text-xs text-text-muted mt-1">
              Verify licensed physicians, inspect patient records, and monitor live consultation triage.
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="self-start sm:self-center px-3.5 py-2 bg-white border border-border-subtle hover:bg-surface-secondary text-primary rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh Registry
          </button>
        </div>

        {/* ── KPI Metric Cards ───────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 mb-8">
          {/* Card 1: Pending Doctor Approvals */}
          <div
            onClick={() => setActiveTab('pending_docs')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'pending_docs'
                ? 'bg-amber-500/10 border-amber-500/40 shadow-xs'
                : 'bg-white border-border-subtle hover:border-amber-500/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Doctor Apps</span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            </div>
            <p className="text-2xl font-bold text-amber-700">{stats.pendingDoctors}</p>
            <span className="text-[10px] text-text-muted mt-0.5 block">Pending Review</span>
          </div>

          {/* Card 2: Verified Clinicians */}
          <div
            onClick={() => setActiveTab('verified_docs')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'verified_docs'
                ? 'bg-accent/10 border-accent/40 shadow-xs'
                : 'bg-white border-border-subtle hover:border-accent/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Medical Staff</span>
              <span className="material-symbols-outlined text-accent text-[18px]">verified</span>
            </div>
            <p className="text-2xl font-bold text-accent">{stats.verifiedDoctors}</p>
            <span className="text-[10px] text-text-muted mt-0.5 block">Verified Doctors</span>
          </div>

          {/* Card 3: Registered Patients */}
          <div
            onClick={() => setActiveTab('patients')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'patients'
                ? 'bg-primary/5 border-primary/40 shadow-xs'
                : 'bg-white border-border-subtle hover:border-primary/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Patients</span>
              <span className="material-symbols-outlined text-text-muted text-[18px]">group</span>
            </div>
            <p className="text-2xl font-bold text-primary">{stats.totalPatients}</p>
            <span className="text-[10px] text-text-muted mt-0.5 block">Registered Cohort</span>
          </div>

          {/* Card 4: Clinical Cases */}
          <div
            onClick={() => setActiveTab('cases')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'cases'
                ? 'bg-primary/5 border-primary/40 shadow-xs'
                : 'bg-white border-border-subtle hover:border-primary/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Consults</span>
              <span className="material-symbols-outlined text-text-muted text-[18px]">clinical_notes</span>
            </div>
            <p className="text-2xl font-bold text-primary">{stats.totalCases}</p>
            <span className="text-[10px] text-text-muted mt-0.5 block">Consultation Tickets</span>
          </div>

          {/* Card 5: Active Care Plans */}
          <div className="p-4 rounded-xl bg-white border border-border-subtle col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Care Plans</span>
              <span className="material-symbols-outlined text-accent text-[18px]">pill</span>
            </div>
            <p className="text-2xl font-bold text-primary">{stats.activeCarePlans}</p>
            <span className="text-[10px] text-text-muted mt-0.5 block">Active Regimens</span>
          </div>
        </div>

        {/* ── Search & Filter Tabs Panel ───────────────────────── */}
        <div className="bg-white border border-border-subtle rounded-2xl p-4 md:p-6 shadow-xs mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border-subtle">
            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setActiveTab('pending_docs')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'pending_docs'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-surface-secondary text-text-muted hover:text-primary'
                }`}
              >
                <span>Doctor Applications</span>
                {stats.pendingDoctors > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    activeTab === 'pending_docs' ? 'bg-white text-amber-600' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {stats.pendingDoctors}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('verified_docs')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'verified_docs'
                    ? 'bg-accent text-white shadow-xs'
                    : 'bg-surface-secondary text-text-muted hover:text-primary'
                }`}
              >
                <span>Verified Medical Staff</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === 'verified_docs' ? 'bg-white text-accent' : 'bg-border-subtle text-primary'
                }`}>
                  {stats.verifiedDoctors}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('patients')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'patients'
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-surface-secondary text-text-muted hover:text-primary'
                }`}
              >
                <span>Patient Registry</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === 'patients' ? 'bg-white/20 text-white' : 'bg-border-subtle text-primary'
                }`}>
                  {stats.totalPatients}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('cases')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'cases'
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-surface-secondary text-text-muted hover:text-primary'
                }`}
              >
                <span>Cases &amp; Triage Audit</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === 'cases' ? 'bg-white/20 text-white' : 'bg-border-subtle text-primary'
                }`}>
                  {stats.totalCases}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('reassignments')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'reassignments'
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-surface-secondary text-text-muted hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                <span>Handover Audit</span>
                {reassignmentHistory.length > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    activeTab === 'reassignments' ? 'bg-white/20 text-white' : 'bg-border-subtle text-primary'
                  }`}>
                    {reassignmentHistory.length}
                  </span>
                )}
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-72">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
                <span className="material-symbols-outlined text-[18px]">search</span>
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, specialty, phone..."
                className="w-full pl-9 pr-8 py-1.5 bg-surface-secondary border border-border-subtle rounded-lg text-xs font-medium text-primary placeholder:text-text-muted focus:bg-white focus:outline-none focus:border-accent transition-all"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-text-muted hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[16px]">cancel</span>
                </button>
              )}
            </div>
          </div>

          {/* ── TAB 1: PENDING DOCTOR APPLICATIONS ───────────── */}
          {activeTab === 'pending_docs' && (
            <div className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-amber-500 text-[18px]">hourglass_top</span>
                  Pending Medical Staff Applications ({pendingDoctorsList.length})
                </h3>
              </div>

              {pendingDoctorsList.length === 0 ? (
                <div className="text-center py-12 bg-surface-secondary/40 border border-dashed border-border-subtle rounded-xl">
                  <span className="material-symbols-outlined text-text-muted text-[36px] mb-2 block">task_alt</span>
                  <p className="text-sm font-bold text-primary">All Doctor Applications Processed</p>
                  <p className="text-xs text-text-muted mt-0.5">No physician accounts are currently awaiting verification.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pendingDoctorsList.map((doc) => (
                    <div
                      key={doc.id}
                      className="bg-white border border-border-subtle rounded-xl p-4.5 flex flex-col justify-between shadow-xs hover:border-amber-400 transition-all"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-700 font-bold text-sm flex items-center justify-center border border-amber-200">
                              {doc.full_name.charAt(0)}
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-primary">{doc.full_name}</h4>
                              <p className="text-xs font-semibold text-accent">{doc.specialty || 'General Practice'}</p>
                            </div>
                          </div>
                          <span className="text-[10px] text-text-muted font-mono whitespace-nowrap">
                            {new Date(doc.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        {/* Contact info */}
                        <div className="text-xs text-text-muted space-y-0.5 py-2 border-t border-b border-border-subtle/60 my-2">
                          {doc.phone && (
                            <p className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">phone</span>
                              <span>{doc.phone}</span>
                            </p>
                          )}
                          <p className="flex items-center gap-1 font-mono text-[10px]">
                            <span className="material-symbols-outlined text-[14px]">badge</span>
                            <span>ID: #{doc.id.slice(0, 8).toUpperCase()}</span>
                          </p>
                        </div>

                        {/* Bio / License */}
                        {doc.bio && (
                          <p className="text-xs text-primary/90 bg-surface-secondary p-2.5 rounded-lg border border-border-subtle text-[11px] leading-relaxed mb-3">
                            {doc.bio}
                          </p>
                        )}
                      </div>

                      {/* Approval Actions */}
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          disabled={actioningId === doc.id}
                          onClick={() => handleApprove(doc.id, doc.full_name)}
                          className="flex-1 py-2 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[16px]">verified</span>
                          {actioningId === doc.id ? 'Verifying...' : 'Approve & Verify'}
                        </button>
                        <button
                          type="button"
                          disabled={actioningId === doc.id}
                          onClick={() => handleReject(doc.id, doc.full_name)}
                          className="px-3 py-2 bg-white hover:bg-red-50 text-red-600 border border-border-subtle rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          title="Reject Application"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 2: VERIFIED CLINICIANS DIRECTORY ─────────── */}
          {activeTab === 'verified_docs' && (
            <div className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-accent text-[18px]">verified_user</span>
                  Verified Active Medical Practitioners ({verifiedDoctorsList.length})
                </h3>
              </div>

              {verifiedDoctorsList.length === 0 ? (
                <div className="text-center py-12 bg-surface-secondary/40 border border-dashed border-border-subtle rounded-xl text-xs text-text-muted">
                  No verified doctors found. Approve pending applications above to activate physicians.
                </div>
              ) : (
                <div className="overflow-x-auto border border-border-subtle rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-surface-secondary text-text-muted text-[11px] uppercase tracking-wider font-bold border-b border-border-subtle">
                        <th className="py-3 px-4">Physician Name</th>
                        <th className="py-3 px-4">Specialty</th>
                        <th className="py-3 px-4">Contact &amp; ID</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {verifiedDoctorsList.map((doc) => (
                        <tr key={doc.id} className="hover:bg-surface-secondary/40 transition-colors">
                          <td className="py-3 px-4 font-bold text-primary">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-accent/15 text-accent font-bold text-xs flex items-center justify-center">
                                {doc.full_name.charAt(0)}
                              </div>
                              <span>{doc.full_name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-semibold text-accent">
                            {doc.specialty || 'General Practice'}
                          </td>
                          <td className="py-3 px-4 text-text-muted">
                            <div>{doc.phone || '—'}</div>
                            <span className="font-mono text-[10px]">#{doc.id.slice(0, 8).toUpperCase()}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/10 text-accent font-bold text-[10px]">
                              <span className="material-symbols-outlined text-[12px]">check_circle</span>
                              Active MD
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleRevoke(doc.id, doc.full_name)}
                              className="px-2.5 py-1 text-xs text-text-muted hover:text-amber-700 hover:bg-amber-50 border border-border-subtle rounded-md transition-colors cursor-pointer"
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: PATIENT REGISTRY ───────────────────────── */}
          {activeTab === 'patients' && (
            <div className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-[18px]">group</span>
                  Registered Patient Cohort ({patientsList.length})
                </h3>
              </div>

              {patientsList.length === 0 ? (
                <div className="text-center py-12 bg-surface-secondary/40 border border-dashed border-border-subtle rounded-xl text-xs text-text-muted">
                  No registered patients match your search.
                </div>
              ) : (
                <div className="overflow-x-auto border border-border-subtle rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-surface-secondary text-text-muted text-[11px] uppercase tracking-wider font-bold border-b border-border-subtle">
                        <th className="py-3 px-4">Patient Name &amp; MRN</th>
                        <th className="py-3 px-4">Gender &amp; Age</th>
                        <th className="py-3 px-4">Attending Physician</th>
                        <th className="py-3 px-4">Contact</th>
                        <th className="py-3 px-4">Registered Date</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {patientsList.map((pat) => {
                        const assignedInfo = patientDoctorMap[pat.id]
                        const assignedDoctor = assignedInfo ? doctors.find((d) => d.id === assignedInfo.doctorId) : null

                        return (
                          <tr key={pat.id} className="hover:bg-surface-secondary/40 transition-colors">
                            <td className="py-3 px-4 font-bold text-primary">
                              <div>{pat.full_name}</div>
                              <span className="font-mono text-[10px] text-text-muted">MRN: #{pat.id.slice(0, 8).toUpperCase()}</span>
                            </td>
                            <td className="py-3 px-4 text-text-muted">
                              <span className="font-semibold text-primary">{pat.gender || 'Not specified'}</span>
                              {pat.age !== null && pat.age !== undefined && (
                                <span className="ml-1.5 px-2 py-0.2 rounded-full bg-surface-secondary text-[10px] font-bold text-text-muted">
                                  {pat.age} yrs
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {assignedDoctor ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-accent/15 text-accent font-bold text-[10px] flex items-center justify-center shrink-0">
                                    {assignedDoctor.full_name.charAt(0)}
                                  </div>
                                  <div>
                                    <div className="font-bold text-primary text-xs">{assignedDoctor.full_name}</div>
                                    <span className="text-[10px] text-text-muted">{assignedDoctor.specialty || 'General Practice'}</span>
                                    {assignedInfo?.status === 'completed' && (
                                      <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[9px] font-bold">
                                        Discharged
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-secondary text-text-muted font-medium text-[10px] border border-border-subtle">
                                  Unassigned
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-text-muted">
                              {pat.phone || '—'}
                            </td>
                            <td className="py-3 px-4 text-text-muted font-mono text-[11px]">
                              {new Date(pat.created_at).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setReassignPatient(pat)
                                  setSelectedNewDoctorId(assignedInfo?.doctorId || '')
                                  setHandoverNotes('')
                                }}
                                className="px-2.5 py-1.5 bg-white border border-border-subtle hover:bg-accent hover:text-white hover:border-accent text-primary rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1 cursor-pointer shadow-xs"
                                title="Reassign Attending Physician"
                              >
                                <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                                <span>Reassign MD</span>
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 4: CLINICAL CASES AUDIT ───────────────────── */}
          {activeTab === 'cases' && (
            <div className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-[18px]">receipt_long</span>
                  Recent Consultation Tickets ({casesList.length})
                </h3>
              </div>

              {casesList.length === 0 ? (
                <div className="text-center py-12 bg-surface-secondary/40 border border-dashed border-border-subtle rounded-xl text-xs text-text-muted">
                  No consultation cases recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto border border-border-subtle rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-surface-secondary text-text-muted text-[11px] uppercase tracking-wider font-bold border-b border-border-subtle">
                        <th className="py-3 px-4">Symptoms / Chief Complaint</th>
                        <th className="py-3 px-4">Urgency Level</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {casesList.map((c) => (
                        <tr key={c.id} className="hover:bg-surface-secondary/40 transition-colors">
                          <td className="py-3 px-4 font-semibold text-primary max-w-[320px] truncate" title={c.symptoms_description}>
                            {c.symptoms_description}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                c.urgency === 'needs_live_call'
                                  ? 'bg-red-100 text-red-700'
                                  : c.urgency === 'somewhat_urgent'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {c.urgency.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="capitalize px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-secondary text-text-muted">
                              {c.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-text-muted font-mono text-[11px]">
                            {new Date(c.created_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Tab 5: Reassignments & Handover Audit ────────── */}
          {activeTab === 'reassignments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                <div>
                  <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                    <span className="material-symbols-outlined text-accent text-[18px]">history_edu</span>
                    Clinical Handover &amp; Reassignment Audit Log
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Immutable record of all patient-physician transfers with clinical handover notes and 3-way notification confirmation.
                  </p>
                </div>
                <span className="text-xs font-bold text-text-muted bg-surface-secondary px-2.5 py-1 rounded-lg border border-border-subtle">
                  {reassignmentHistory.length} Recorded Transfer{reassignmentHistory.length === 1 ? '' : 's'}
                </span>
              </div>

              {reassignmentHistory.length === 0 ? (
                <div className="p-8 text-center bg-surface-secondary/40 rounded-xl border border-border-subtle">
                  <span className="material-symbols-outlined text-text-muted text-4xl mb-2">swap_horiz</span>
                  <h4 className="text-sm font-bold text-primary">No Reassignments Recorded</h4>
                  <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto">
                    When hospital administrators reassign patients between attending physicians, full audit records and handover notes will appear here.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border-subtle">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-secondary/70 border-b border-border-subtle font-bold text-text-muted uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Patient</th>
                        <th className="py-3 px-4">Previous Physician</th>
                        <th className="py-3 px-4">Transferred To</th>
                        <th className="py-3 px-4">Handover Notes</th>
                        <th className="py-3 px-4">Timestamp</th>
                        <th className="py-3 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle font-medium">
                      {reassignmentHistory.map((item) => (
                        <tr key={item.id} className="hover:bg-surface-secondary/30 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-bold text-primary block">{item.patient_name}</span>
                            <span className="text-[10px] text-text-muted font-mono">#{item.patient_id.slice(0, 8).toUpperCase()}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-semibold text-[11px] inline-flex items-center gap-1 border border-gray-200">
                              <span className="material-symbols-outlined text-[13px] text-text-muted">person_remove</span>
                              {item.old_doctor_name}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-md bg-accent/10 text-accent font-semibold text-[11px] inline-flex items-center gap-1 border border-accent/20">
                              <span className="material-symbols-outlined text-[13px] text-accent">how_to_reg</span>
                              {item.new_doctor_name}
                            </span>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <p className="text-[11px] text-primary line-clamp-2 italic" title={item.notes}>
                              &ldquo;{item.notes}&rdquo;
                            </p>
                          </td>
                          <td className="py-3 px-4 text-text-muted font-mono text-[11px] whitespace-nowrap">
                            {new Date(item.created_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                              Notified (3/3)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Reassign Attending Physician Modal ──────────────── */}
      {reassignPatient && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-border-subtle animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle mb-4">
              <div className="flex items-center gap-2 text-primary font-bold text-base">
                <span className="material-symbols-outlined text-[22px] text-accent">swap_horiz</span>
                <h3>Reassign Attending Physician</h3>
              </div>
              <button
                type="button"
                onClick={() => setReassignPatient(null)}
                className="text-text-muted hover:text-primary transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Patient Demographic Summary Card */}
            <div className="mb-4 bg-surface-secondary/50 border border-border-subtle rounded-xl p-3.5 flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-primary block text-sm">{reassignPatient.full_name}</span>
                <span className="text-text-muted font-mono text-[11px]">MRN: #{reassignPatient.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="text-right text-text-muted">
                <span className="block font-medium">{reassignPatient.gender || 'Patient'}</span>
                <span>{reassignPatient.phone || 'No phone'}</span>
              </div>
            </div>

            {/* Current Doctor Note */}
            <div className="mb-4 p-3 rounded-xl bg-accent/5 border border-accent/20 text-xs text-primary">
              <span className="font-bold block text-text-muted mb-1 uppercase tracking-wider text-[10px]">Current Attending MD</span>
              {(() => {
                const currentInfo = patientDoctorMap[reassignPatient.id]
                const currentDoctor = currentInfo ? doctors.find((d) => d.id === currentInfo.doctorId) : null
                if (currentDoctor) {
                  return (
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-accent text-[16px]">stethoscope</span>
                      <span className="font-bold">{currentDoctor.full_name}</span>
                      <span className="text-text-muted">({currentDoctor.specialty || 'General Practice'})</span>
                    </div>
                  )
                }
                return <span className="text-text-muted italic">Currently unassigned to any physician</span>
              })()}
            </div>

            <form onSubmit={handleExecuteReassignment} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-primary mb-1.5">
                  Select New Attending Physician *
                </label>
                <select
                  value={selectedNewDoctorId}
                  onChange={(e) => setSelectedNewDoctorId(e.target.value)}
                  className="w-full p-2.5 border border-border-subtle rounded-xl text-xs bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                  required
                >
                  <option value="">-- Select a verified doctor --</option>
                  {doctors
                    .filter((d) => d.verified)
                    .map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.full_name} — {doc.specialty || 'General Practice'}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-primary mb-1.5">
                  Clinical Handover Reason / Audit Notes
                </label>
                <textarea
                  rows={3}
                  value={handoverNotes}
                  onChange={(e) => setHandoverNotes(e.target.value)}
                  placeholder="e.g., Physician schedule change, specialist handover to Cardiology, primary care doctor reassignment..."
                  className="w-full text-xs p-3 border border-border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent bg-surface-secondary/30 text-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={reassignSubmitting}
                  onClick={() => setReassignPatient(null)}
                  className="px-4 py-2 border border-border-subtle rounded-xl text-xs font-semibold text-text-muted hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reassignSubmitting || !selectedNewDoctorId}
                  className="px-4 py-2 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  {reassignSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Reassigning...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                      <span>Confirm Reassignment</span>
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