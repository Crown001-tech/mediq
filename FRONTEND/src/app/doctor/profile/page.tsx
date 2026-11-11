'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, clearAuthCookie } from '@/lib/supabase'
import { formatDoctorName } from '@/shared/utils'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import DoctorBottomNav from '@/components/dashboard/DoctorBottomNav'

const MEDICAL_SPECIALTIES = [
  'General Practice / Family Medicine',
  'Internal Medicine',
  'Cardiology',
  'Pediatrics & Child Health',
  'Obstetrics & Gynaecology',
  'General Surgery',
  'Radiology & Diagnostic Imaging',
  'Dermatology',
  'Psychiatry & Behavioral Health',
  'Orthopedic Surgery',
  'Emergency Medicine',
  'Ophthalmology',
  'ENT / Otorhinolaryngology',
  'Anesthesiology & Critical Care',
]

export default function DoctorProfilePage() {
  const [userId, setUserId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [specialty, setSpecialty] = useState(MEDICAL_SPECIALTIES[0])
  const [bio, setBio] = useState('')
  const [verified, setVerified] = useState(false)
  const [createdAt, setCreatedAt] = useState('')

  // Edit fields
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editSpecialty, setEditSpecialty] = useState(MEDICAL_SPECIALTIES[0])
  const [editBio, setEditBio] = useState('')

  // Metrics
  const [stats, setStats] = useState({
    activeCohort: 0,
    consultationsResolved: 0,
    carePlansIssued: 0,
  })

  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [resettingPassword, setResettingPassword] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const router = useRouter()

  const showToast = (message: string, error = false) => {
    setToast({ message, error })
    setTimeout(() => setToast(null), 3500)
  }

  const copyDoctorId = () => {
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
        .select('full_name, phone, specialty, bio, verified, created_at, role')
        .eq('id', user.id)
        .maybeSingle()

      if (profile) {
        if (profile.role !== 'doctor') {
          router.push('/login')
          return
        }

        setFullName(profile.full_name || '')
        setPhone(profile.phone || '')
        setSpecialty(profile.specialty || MEDICAL_SPECIALTIES[0])
        setBio(profile.bio || '')
        setVerified(!!profile.verified)
        setCreatedAt(profile.created_at || '')

        setEditName(profile.full_name || '')
        setEditPhone(profile.phone || '')
        setEditSpecialty(profile.specialty || MEDICAL_SPECIALTIES[0])
        setEditBio(profile.bio || '')
      }

      // Fetch Doctor Clinical Metrics
      const [casesRes, responsesRes, plansRes] = await Promise.all([
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('doctor_id', user.id),
        supabase.from('responses').select('id', { count: 'exact', head: true }).eq('doctor_id', user.id),
        supabase.from('care_plans').select('id', { count: 'exact', head: true }).eq('doctor_id', user.id),
      ])

      setStats({
        activeCohort: casesRes.count || 0,
        consultationsResolved: responsesRes.count || 0,
        carePlansIssued: plansRes.count || 0,
      })

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editName.trim()) {
      showToast('Physician name cannot be empty.', true)
      return
    }

    setSaving(true)

    const cleanName = formatDoctorName(editName)

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: cleanName,
        phone: editPhone.trim() || null,
        specialty: editSpecialty,
        bio: editBio.trim() || null,
      })
      .eq('id', userId)

    setSaving(false)

    if (error) {
      showToast(`Error updating credentials: ${error.message}`, true)
    } else {
      setFullName(cleanName)
      setPhone(editPhone.trim())
      setSpecialty(editSpecialty)
      setBio(editBio.trim())
      showToast('Clinical credentials updated successfully.')
    }
  }

  const handlePasswordReset = async () => {
    if (!email) return
    setResettingPassword(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/doctor/profile`,
    })

    setResettingPassword(false)

    if (error) {
      showToast(`Password reset error: ${error.message}`, true)
    } else {
      showToast(`Password recovery link sent to ${email}`)
    }
  }

  const handleLogout = async () => {
    if (confirm('Sign out of the MEDIQ Clinical Portal?')) {
      clearAuthCookie()
      await supabase.auth.signOut()
      router.push('/login')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-text-muted">Loading practitioner profile...</p>
      </div>
    )
  }

  const initials = fullName
    ? fullName
        .replace(/^Dr\.\s*/i, '')
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'DR'

  const formattedJoinDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      })
    : 'Active'

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans antialiased text-primary">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="Profile" />
      <DoctorDesktopHeader fullName={fullName} />

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex flex-col pb-28 md:pb-12 transition-all duration-300 ease-in-out">
        {/* Floating Feedback Toast */}
        {toast && (
          <div className="fixed top-5 right-5 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
            <div
              className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center gap-2.5 shadow-sm backdrop-blur-md ${
                toast.error
                  ? 'bg-red-50/95 border-red-200 text-red-800'
                  : 'bg-white/95 border-border-subtle text-primary'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  toast.error ? 'bg-red-500' : 'bg-accent'
                }`}
              />
              <span>{toast.message}</span>
            </div>
          </div>
        )}

        <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
          {/* ── Page Header ─────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-border-subtle pb-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-primary">
                Practitioner Registry & Credentials
              </h1>
              <p className="text-xs text-text-muted mt-0.5">
                Manage your accredited physician credentials, active specialties, and clinical directory profile.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold ${
                  verified
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50/80 border-amber-200 text-amber-800'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    verified ? 'bg-emerald-600' : 'bg-amber-500 animate-pulse'
                  }`}
                />
                {verified ? 'MDCN Verified Clinical Staff' : 'Accreditation Pending Review'}
              </span>
            </div>
          </div>

          {/* ── 2-Column Responsive Layout ───────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* ── Left Column: Doctor Identity & Accreditation ─ */}
            <div className="lg:col-span-4 bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs space-y-5 lg:sticky lg:top-6">
              {/* Doctor Monogram & Specialty */}
              <div className="flex flex-col items-center text-center space-y-3 pb-5 border-b border-border-subtle">
                <div className="w-16 h-16 rounded-2xl bg-surface-secondary border border-border-subtle flex items-center justify-center text-accent font-bold text-xl shadow-xs">
                  {initials}
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary leading-snug flex items-center justify-center gap-1">
                    {fullName || 'Medical Officer'}
                    {verified && (
                      <span className="material-symbols-outlined text-accent text-[18px]" title="MDCN Verified">
                        verified
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-text-muted mt-0.5">{email}</p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-secondary text-primary text-xs font-semibold border border-border-subtle">
                  <span className="material-symbols-outlined text-[14px] text-accent">stethoscope</span>
                  {specialty}
                </div>
              </div>

              {/* Practice Metadata Details List */}
              <div className="space-y-3 text-xs">
                {/* Staff ID */}
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Physician Registry ID</span>
                  <button
                    type="button"
                    onClick={copyDoctorId}
                    className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-primary hover:text-accent transition-colors cursor-pointer"
                    title="Click to copy ID"
                  >
                    <span>{userId ? `DOC-${userId.substring(0, 8).toUpperCase()}` : '—'}</span>
                    <span className="material-symbols-outlined text-[13px]">
                      {copiedId ? 'check' : 'content_copy'}
                    </span>
                  </button>
                </div>

                {/* Duty Status */}
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Clinical Duty Status</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Active & Available
                  </span>
                </div>

                {/* Direct Phone */}
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Clinical Contact</span>
                  <span className="font-medium text-primary">{phone || 'None configured'}</span>
                </div>

                {/* Member Since */}
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Accredited Since</span>
                  <span className="font-medium text-primary">{formattedJoinDate}</span>
                </div>
              </div>

              {/* Directorate Compliance Seal */}
              <div className="p-3 bg-surface-secondary/60 rounded-xl border border-border-subtle text-[11px] text-text-muted space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-primary">
                  <span className="material-symbols-outlined text-[15px] text-accent">local_hospital</span>
                  <span>MEDIQ Clinical Directorate</span>
                </div>
                <p className="leading-relaxed">
                  Prescription protocols and clinical reviews issued under this profile adhere to MDCN telehealth guidelines.
                </p>
              </div>
            </div>

            {/* ── Right Column: Practice Metrics & Settings ───── */}
            <div className="lg:col-span-8 space-y-6">
              {/* 1. Clinical Practice Activity (Bento Metric Grid) */}
              <div className="bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-accent">clinical_notes</span>
                    Practitioner Caseload & Output
                  </h3>
                  <span className="text-[11px] text-text-muted">Live Directorate Stats</span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3.5 bg-surface-secondary/50 rounded-xl border border-border-subtle">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">
                      Patient Cohort
                    </span>
                    <span className="text-xl font-bold text-primary mt-1 block">
                      {stats.activeCohort}
                    </span>
                    <span className="text-[10px] text-text-muted mt-0.5 block">Under direct care</span>
                  </div>

                  <div className="p-3.5 bg-surface-secondary/50 rounded-xl border border-border-subtle">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">
                      Consultations
                    </span>
                    <span className="text-xl font-bold text-primary mt-1 block">
                      {stats.consultationsResolved}
                    </span>
                    <span className="text-[10px] text-text-muted mt-0.5 block">Reviews completed</span>
                  </div>

                  <div className="p-3.5 bg-surface-secondary/50 rounded-xl border border-border-subtle">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">
                      Care Plans
                    </span>
                    <span className="text-xl font-bold text-primary mt-1 block">
                      {stats.carePlansIssued}
                    </span>
                    <span className="text-[10px] text-text-muted mt-0.5 block">Active protocols</span>
                  </div>
                </div>
              </div>

              {/* 2. Clinical Credentials & Practice Form */}
              <div className="bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-accent">badge</span>
                      Practitioner Credentials & Department
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      Information displayed on official prescription sheets, patient referrals, and clinical reviews.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSave} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Physician Name */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="editDocName">
                        Practitioner Display Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="editDocName"
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="e.g. Dr. Sarah Jenkins"
                        className="w-full h-10 px-3.5 bg-surface border border-border-subtle rounded-xl text-xs font-medium text-primary focus:border-accent transition-all shadow-2xs"
                      />
                    </div>

                    {/* Medical Specialty */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="editDocSpecialty">
                        Department / Specialty <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="editDocSpecialty"
                        value={editSpecialty}
                        onChange={(e) => setEditSpecialty(e.target.value)}
                        className="w-full h-10 px-3.5 bg-surface border border-border-subtle rounded-xl text-xs font-medium text-primary focus:border-accent transition-all shadow-2xs cursor-pointer"
                      >
                        {MEDICAL_SPECIALTIES.map((spec) => (
                          <option key={spec} value={spec}>
                            {spec}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Direct Clinical Contact Line */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="editDocPhone">
                      Direct Clinical / Hospital Extension
                    </label>
                    <input
                      id="editDocPhone"
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="e.g. +234 800 987 6543"
                      className="w-full h-10 px-3.5 bg-surface border border-border-subtle rounded-xl text-xs font-medium text-primary focus:border-accent transition-all shadow-2xs"
                    />
                  </div>

                  {/* Bio & MDCN License Credentials */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="editDocBio">
                        Licensing Credentials & Clinical Bio
                      </label>
                      <span className="text-[11px] text-text-muted">
                        Printed on official care plans
                      </span>
                    </div>
                    <textarea
                      id="editDocBio"
                      rows={4}
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      placeholder="MDCN License #12345 · Senior Consultant with focus on acute and chronic telemetry..."
                      className="w-full p-3.5 bg-surface border border-border-subtle rounded-xl text-xs font-medium text-primary focus:border-accent transition-all shadow-2xs resize-none"
                    />
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2.5 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                    >
                      {saving ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Saving Profile...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[16px]">save</span>
                          <span>Save Clinical Profile</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* 3. Directorate Security & Access Controls */}
              <div className="bg-white border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xs space-y-4">
                <div className="border-b border-border-subtle pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-accent">vpn_key</span>
                    Directorate Authentication & Session
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Manage practitioner authentication keys and secure portal access.
                  </p>
                </div>

                <div className="divide-y divide-border-subtle text-xs">
                  {/* Password Reset */}
                  <div className="py-3.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-primary">Password Recovery</h4>
                      <p className="text-text-muted mt-0.5">
                        Dispatch a secure credential reset link to {email}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={resettingPassword}
                      className="px-3.5 py-2 bg-surface hover:bg-surface-secondary border border-border-subtle rounded-xl font-bold text-primary transition-all self-start sm:self-auto cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">mail</span>
                      {resettingPassword ? 'Sending...' : 'Send Reset Link'}
                    </button>
                  </div>

                  {/* Sign Out */}
                  <div className="py-3.5 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-red-600">Terminate Active Clinical Session</h4>
                      <p className="text-text-muted mt-0.5">
                        Sign out of the MEDIQ Clinical Portal on this workstation.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="px-3.5 py-2 bg-surface hover:bg-red-50 border border-border-subtle hover:border-red-200 rounded-xl font-bold text-red-600 transition-all self-start sm:self-auto cursor-pointer flex items-center gap-1.5"
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

      <DoctorBottomNav />
    </div>
  )
}