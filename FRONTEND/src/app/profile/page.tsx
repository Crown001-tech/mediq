'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, clearAuthCookie } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'

function calculateAge(dobString: string): number | null {
  if (!dobString) return null
  const dob = new Date(dobString)
  if (isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--
  }
  return age >= 0 && age <= 125 ? age : null
}

export default function PatientProfilePage() {
  const [userId, setUserId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState<'Female' | 'Male' | string>('Female')
  const [createdAt, setCreatedAt] = useState('')

  // Edit fields
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editDob, setEditDob] = useState('')
  const [editGender, setEditGender] = useState('Female')

  // Clinical Summary
  const [stats, setStats] = useState({
    totalCases: 0,
    activePlans: 0,
    dosesLogged: 0,
  })

  const [doctorName, setDoctorName] = useState('Attending Physician')
  const [doctorSpecialty, setDoctorSpecialty] = useState('General Practice')
  const [hasAssignedDoctor, setHasAssignedDoctor] = useState(false)

  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [resettingPassword, setResettingPassword] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const router = useRouter()

  useEffect(() => {
    try {
      const stored = localStorage.getItem('mediq_sidebar_collapsed') === 'true'
      setSidebarCollapsed(stored)
    } catch { }

    const handleSidebarToggle = (e: any) => {
      setSidebarCollapsed(e.detail?.collapsed ?? false)
    }
    window.addEventListener('mediq_sidebar_toggle', handleSidebarToggle)
    return () => window.removeEventListener('mediq_sidebar_toggle', handleSidebarToggle)
  }, [])

  const computedAge = useMemo(() => calculateAge(editDob), [editDob])
  const displayAge = useMemo(() => calculateAge(dob), [dob])

  const showToast = (message: string, error = false) => {
    setToast({ message, error })
    setTimeout(() => setToast(null), 3500)
  }

  const copyPatientId = () => {
    if (!userId) return
    navigator.clipboard.writeText(userId)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)
      setEmail(user.email || '')

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, date_of_birth, age, gender, created_at, role')
        .eq('id', user.id)
        .maybeSingle()

      if (profile) {
        if (profile.role === 'doctor') {
          router.push('/doctor/profile')
          return
        }
        if (profile.role === 'admin') {
          router.push('/admin')
          return
        }

        setFullName(profile.full_name || '')
        setPhone(profile.phone || '')
        setDob(profile.date_of_birth || '')
        setGender(profile.gender || 'Female')
        setCreatedAt(profile.created_at || '')

        setEditName(profile.full_name || '')
        setEditPhone(profile.phone || '')
        setEditDob(profile.date_of_birth || '')
        setEditGender(profile.gender || 'Female')
      }

      // Fetch Patient Metrics
      const [casesRes, plansRes, dosesRes] = await Promise.all([
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('patient_id', user.id),
        supabase.from('care_plans').select('id', { count: 'exact', head: true }).eq('patient_id', user.id).eq('active', true),
        supabase.from('dose_logs').select('id', { count: 'exact', head: true }).eq('patient_id', user.id),
      ])

      setStats({
        totalCases: casesRes.count || 0,
        activePlans: plansRes.count || 0,
        dosesLogged: dosesRes.count || 0,
      })

      // 3. Resolve Attending Physician
      let docId: string | null = null

      try {
        const { data: enroll } = await supabase
          .from('enrollments')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (enroll?.doctor_id) docId = enroll.doctor_id
      } catch { }

      if (!docId) {
        try {
          const res = await fetch('/api/admin/patient-assignments')
          if (res.ok) {
            const json = await res.json()
            const match = json?.assignments?.find((a: any) => a.patient_id === user.id)
            if (match?.doctor_id) docId = match.doctor_id
          }
        } catch { }
      }

      if (!docId) {
        try {
          const stored = localStorage.getItem('mediq_assigned_doctor_id')
          if (stored) docId = stored
        } catch { }
      }

      if (!docId) {
        try {
          const { data: cp } = await supabase
            .from('care_plans')
            .select('doctor_id')
            .eq('patient_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (cp?.doctor_id) docId = cp.doctor_id
        } catch { }
      }

      if (docId) {
        try {
          const { data: docProf } = await supabase
            .from('profiles')
            .select('full_name, specialty')
            .eq('id', docId)
            .maybeSingle()
          if (docProf?.full_name) {
            setDoctorName(docProf.full_name)
            if (docProf.specialty) setDoctorSpecialty(docProf.specialty)
            setHasAssignedDoctor(true)
          }
        } catch { }
      }

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editName.trim()) {
      showToast('Full legal name is required.', true)
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: editName.trim(),
        phone: editPhone.trim() || null,
        date_of_birth: editDob || null,
        age: computedAge,
        gender: editGender || null,
      })
      .eq('id', userId)

    setSaving(false)

    if (error) {
      showToast(`Error updating profile: ${error.message}`, true)
    } else {
      setFullName(editName.trim())
      setPhone(editPhone.trim())
      setDob(editDob)
      setGender(editGender)
      showToast('Personal information updated successfully.')
    }
  }

  const handlePasswordReset = async () => {
    if (!email) return
    setResettingPassword(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/profile`,
    })

    setResettingPassword(false)

    if (error) {
      showToast(`Password reset error: ${error.message}`, true)
    } else {
      showToast(`Password recovery link dispatched to ${email}`)
    }
  }

  const handleLogout = async () => {
    if (confirm('Sign out of your MEDIQ patient account?')) {
      clearAuthCookie()
      await supabase.auth.signOut()
      router.push('/login')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-text-muted">Loading patient account...</p>
      </div>
    )
  }

  const initials = fullName
    ? fullName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase()
    : 'PT'

  const formattedJoinDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    })
    : 'Active'

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="Profile" />
      <DesktopHeader fullName={fullName} />
      <TopBar />

      <main
        className={`flex flex-col pb-28 md:pb-12 transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'md:ml-20' : 'md:ml-64'
        }`}
      >
        {/* Floating Feedback Toast */}
        {toast && (
          <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-5 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
            <div
              className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center gap-2.5 shadow-sm backdrop-blur-md ${toast.error
                  ? 'bg-red-50/95 border-red-200 text-red-800'
                  : 'bg-white/95 border-border-subtle text-primary'
                }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${toast.error ? 'bg-red-500' : 'bg-accent'
                  }`}
              />
              <span className="truncate">{toast.message}</span>
            </div>
          </div>
        )}

        <div className="max-w-5xl mx-auto w-full px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8 space-y-3.5 sm:space-y-6">
          {/* ── Page Title Header ────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 pb-3 sm:pb-5 border-b border-border-subtle">
            <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-gradient-to-br from-accent/15 via-accent/10 to-teal-500/5 border border-accent/25 text-accent flex items-center justify-center shrink-0 shadow-xs">
                <span className="material-symbols-outlined text-[20px] sm:text-[24px]">clinical_notes</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-primary truncate">
                  Clinical Profile
                </h1>
                <p className="text-[11px] sm:text-xs text-text-muted font-medium truncate">
                  Personal medical records &amp; account settings
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-white border border-border-subtle text-[11px] sm:text-xs font-semibold text-text-muted shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="hidden sm:inline">Active Medical File</span>
                <span className="sm:hidden">Active File</span>
              </span>
            </div>
          </div>

          {/* ── 2-Column Responsive Layout ───────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-6 items-start">
            {/* ── Left Column: Identity & Security Card ───────── */}
            <div className="lg:col-span-4 bg-white border border-border-subtle rounded-2xl p-4 sm:p-5 md:p-6 shadow-xs space-y-4 sm:space-y-5 lg:sticky lg:top-6">
              {/* Profile Monogram & Name */}
              <div className="flex sm:flex-col items-center sm:text-center gap-3 sm:gap-3 pb-3.5 sm:pb-5 border-b border-border-subtle">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-br from-accent/15 via-surface-secondary to-accent/5 border border-accent/25 flex items-center justify-center text-accent font-extrabold text-base sm:text-xl shadow-xs shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1 sm:flex-initial text-left sm:text-center">
                  <h2 className="text-sm sm:text-base font-bold text-primary leading-snug truncate">
                    {fullName || 'Patient Account'}
                  </h2>
                  <p className="text-[11px] sm:text-xs text-text-muted mt-0.5 font-medium truncate break-all">{email}</p>
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-emerald-50 border border-emerald-200/70 text-emerald-800 text-[10px] sm:text-[11px] font-semibold mt-1">
                    <span className="material-symbols-outlined text-[13px] sm:text-[14px] text-emerald-600">verified</span>
                    Verified Patient Record
                  </div>
                </div>
              </div>

              {/* Identity Details List */}
              <div className="space-y-2.5 sm:space-y-3 text-xs">
                {/* ID Tag */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">Medical Record ID</span>
                  <button
                    type="button"
                    onClick={copyPatientId}
                    className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-primary hover:text-accent transition-colors cursor-pointer"
                    title="Click to copy ID"
                  >
                    <span>{userId ? `PT-${userId.substring(0, 8).toUpperCase()}` : '—'}</span>
                    <span className="material-symbols-outlined text-[13px]">
                      {copiedId ? 'check' : 'content_copy'}
                    </span>
                  </button>
                </div>

                {/* Gender */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">Gender</span>
                  <span className="font-medium text-primary">{gender || 'Not specified'}</span>
                </div>

                {/* Age & DOB */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">Age / DOB</span>
                  <span className="font-medium text-primary text-right">
                    {displayAge !== null ? `${displayAge} yrs` : '—'}{' '}
                    {dob && <span className="text-text-muted font-normal">({dob})</span>}
                  </span>
                </div>

                {/* Registered Phone */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">Contact Phone</span>
                  <span className="font-medium text-primary truncate max-w-[55%] text-right">{phone || 'None set'}</span>
                </div>

                {/* Joined Date */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">Patient Since</span>
                  <span className="font-medium text-primary">{formattedJoinDate}</span>
                </div>
              </div>

              {/* Trust Badge */}
              <div className="p-3 bg-surface-secondary/60 rounded-xl border border-border-subtle text-[11px] text-text-muted space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-primary">
                  <span className="material-symbols-outlined text-[15px] text-accent">lock</span>
                  <span>HIPAA &amp; Encrypted Record</span>
                </div>
                <p className="leading-relaxed">
                  Your medical data is encrypted and protected under strict clinical confidentiality.
                </p>
              </div>

              {/* Attending Physician Card */}
              <div className="p-3.5 sm:p-4 bg-accent/5 rounded-xl sm:rounded-2xl border border-accent/20 space-y-2.5 sm:space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-accent flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px] sm:text-[15px]">stethoscope</span>
                    Attending Physician
                  </span>
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-primary truncate">
                    {formatDoctorName(doctorName)}
                  </h4>
                  <p className="text-[11px] sm:text-xs text-text-muted mt-0.5 truncate">{doctorSpecialty}</p>
                </div>
                <div className="pt-2 border-t border-accent/15 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-text-muted">Direct Care Team</span>
                  <Link
                    href="/messages"
                    className="text-xs font-bold text-accent hover:underline flex items-center gap-1"
                  >
                    <span>Message</span>
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </Link>
                </div>
              </div>
            </div>

            {/* ── Right Column: Metrics, Forms & Controls ──────── */}
            <div className="lg:col-span-8 space-y-3.5 sm:space-y-6">
              {/* 1. Care Activity Snapshot (3-Card Bento Metric Grid) */}
              <div className="bg-white border border-border-subtle rounded-2xl p-3.5 sm:p-5 md:p-6 shadow-xs space-y-2.5 sm:space-y-3">
                <div className="flex items-center justify-between border-b border-border-subtle pb-2.5 sm:pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] sm:text-[16px] text-accent">query_stats</span>
                    Clinical Activity
                  </h3>
                  <span className="text-[10px] sm:text-[11px] text-text-muted">Live metrics</span>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="p-2 sm:p-3.5 bg-surface-secondary/50 rounded-xl border border-border-subtle text-center sm:text-left">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-text-muted block truncate">
                      Cases
                    </span>
                    <span className="text-base sm:text-xl font-bold text-primary mt-0.5 sm:mt-1 block">
                      {stats.totalCases}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-text-muted mt-0.5 block truncate">Submitted</span>
                  </div>

                  <div className="p-2 sm:p-3.5 bg-surface-secondary/50 rounded-xl border border-border-subtle text-center sm:text-left">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-text-muted block truncate">
                      Care Plans
                    </span>
                    <span className="text-base sm:text-xl font-bold text-primary mt-0.5 sm:mt-1 block">
                      {stats.activePlans}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-text-muted mt-0.5 block truncate">Active</span>
                  </div>

                  <div className="p-2 sm:p-3.5 bg-surface-secondary/50 rounded-xl border border-border-subtle text-center sm:text-left">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-text-muted block truncate">
                      Doses
                    </span>
                    <span className="text-base sm:text-xl font-bold text-primary mt-0.5 sm:mt-1 block">
                      {stats.dosesLogged}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-text-muted mt-0.5 block truncate">Logged</span>
                  </div>
                </div>
              </div>

              {/* 2. Personal Demographics Edit Form */}
              <div className="bg-white border border-border-subtle rounded-2xl p-3.5 sm:p-5 md:p-6 shadow-xs space-y-3.5 sm:space-y-5">
                <div className="flex items-center justify-between border-b border-border-subtle pb-2.5 sm:pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] sm:text-[16px] text-accent">edit_note</span>
                      Demographic &amp; Contact Details
                    </h3>
                    <p className="text-[11px] sm:text-xs text-text-muted mt-0.5">
                      Keep your legal name, birthday, and contact numbers accurate.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSave} className="space-y-3.5 sm:space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {/* Legal Name */}
                    <div className="space-y-1">
                      <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="editName">
                        Full Legal Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="editName"
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full h-10 px-3.5 bg-surface border border-border-subtle rounded-xl text-sm sm:text-xs font-medium text-primary focus:border-accent transition-all shadow-2xs"
                      />
                    </div>

                    {/* Contact Phone */}
                    <div className="space-y-1">
                      <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="editPhone">
                        Contact Phone
                      </label>
                      <input
                        id="editPhone"
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="e.g. +234 800 123 4567"
                        className="w-full h-10 px-3.5 bg-surface border border-border-subtle rounded-xl text-sm sm:text-xs font-medium text-primary focus:border-accent transition-all shadow-2xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-1">
                    {/* Date of Birth & Live Age Pill */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="editDob">
                          Date of Birth
                        </label>
                        {computedAge !== null && (
                          <span className="text-[11px] font-semibold text-accent">
                            {computedAge} years old
                          </span>
                        )}
                      </div>
                      <input
                        id="editDob"
                        type="date"
                        value={editDob}
                        onChange={(e) => setEditDob(e.target.value)}
                        max={new Date().toISOString().split('T')[0]}
                        className="w-full h-10 px-3.5 bg-surface border border-border-subtle rounded-xl text-sm sm:text-xs font-medium text-primary focus:border-accent transition-all shadow-2xs"
                      />
                    </div>

                    {/* Gender Segmented Control */}
                    <div className="space-y-1">
                      <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-text-muted">
                        Gender
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-surface-secondary rounded-xl border border-border-subtle h-10 items-center">
                        <button
                          type="button"
                          onClick={() => setEditGender('Female')}
                          className={`h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${editGender === 'Female'
                              ? 'bg-white text-primary shadow-xs'
                              : 'text-text-muted hover:text-primary'
                            }`}
                        >
                          Female
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditGender('Male')}
                          className={`h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${editGender === 'Male'
                              ? 'bg-white text-primary shadow-xs'
                              : 'text-text-muted hover:text-primary'
                            }`}
                        >
                          Male
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="w-full sm:w-auto px-5 py-2.5 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                    >
                      {saving ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Saving Changes...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[16px]">save</span>
                          <span>Save Changes</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* 3. Account Security & Session Controls */}
              <div className="bg-white border border-border-subtle rounded-2xl p-3.5 sm:p-5 md:p-6 shadow-xs space-y-3 sm:space-y-4">
                <div className="border-b border-border-subtle pb-2.5 sm:pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] sm:text-[16px] text-accent">security</span>
                    Security &amp; Session Controls
                  </h3>
                  <p className="text-[11px] sm:text-xs text-text-muted mt-0.5">
                    Manage password recovery and active authenticated sessions.
                  </p>
                </div>

                <div className="divide-y divide-border-subtle text-xs">
                  {/* Password Reset */}
                  <div className="py-3 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-bold text-primary">Password Recovery</h4>
                      <p className="text-text-muted mt-0.5 break-all text-[11px] sm:text-xs">
                        Dispatch a secure password reset link to {email}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={resettingPassword}
                      className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-surface hover:bg-surface-secondary border border-border-subtle rounded-xl font-bold text-xs text-primary transition-all justify-center cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[16px]">mail</span>
                      {resettingPassword ? 'Sending...' : 'Send Reset Link'}
                    </button>
                  </div>

                  {/* Sign Out */}
                  <div className="py-3 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-red-600">Terminate Active Session</h4>
                      <p className="text-text-muted mt-0.5 text-[11px] sm:text-xs">
                        Sign out of your active MEDIQ patient session on this browser.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-surface hover:bg-red-50 border border-border-subtle hover:border-red-200 rounded-xl font-bold text-xs text-red-600 transition-all justify-center cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[16px]">logout</span>
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  )
}