'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

import { formatDoctorName } from '@/shared/utils'

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

export default function DoctorApplyPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [specialty, setSpecialty] = useState(MEDICAL_SPECIALTIES[0])
  const [licenseNumber, setLicenseNumber] = useState('')
  const [bio, setBio] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [refCode, setRefCode] = useState('')

  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!fullName.trim() || !email.trim() || !password) {
      setError('Please fill in all required fields.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    setSubmitting(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })

    if (signUpError) {
      setError(signUpError.message)
      setSubmitting(false)
      return
    }

    if (data.user) {
      const bioWithLicense = licenseNumber.trim()
        ? `[MDCN/License: ${licenseNumber.trim()}] ${bio.trim()}`
        : bio.trim()

      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        full_name: formatDoctorName(fullName),
        role: 'doctor',
        phone: phone.trim() || null,
        specialty,
        bio: bioWithLicense || null,
        verified: false,
      })

      if (profileError) {
        setError(profileError.message)
        setSubmitting(false)
        return
      }
    }

    const generatedRef = `DOC-REG-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    setRefCode(generatedRef)
    setSubmitting(false)
    setSubmitted(true)
  }

  // ── Success / Under Review State ─────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 md:p-8 font-sans antialiased text-primary">
        <div className="max-w-[560px] w-full bg-white border border-border-subtle rounded-2xl p-6 md:p-10 shadow-sm text-center">
          {/* Status Badge & Icon */}
          <div className="w-16 h-16 rounded-full bg-accent/10 text-accent flex items-center justify-center mx-auto mb-4 border border-accent/20">
            <span className="material-symbols-outlined text-[36px]">hourglass_top</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold uppercase tracking-wider mb-3">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Application Under Clinical Review
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-primary tracking-tight mb-2">
            Credential Verification Pending
          </h1>

          <p className="text-xs md:text-sm text-text-muted leading-relaxed mb-6">
            Thank you, <strong className="text-primary">{formatDoctorName(fullName)}</strong>. Your registration details and medical specialty ({specialty}) have been logged in the MEDIQ Medical Directorate.
          </p>

          {/* Reference Box */}
          <div className="bg-surface-secondary border border-border-subtle rounded-xl p-4 mb-6 text-left">
            <div className="flex justify-between items-center text-xs pb-2 border-b border-border-subtle/80 mb-2">
              <span className="text-text-muted font-semibold">Application Reference</span>
              <span className="font-mono font-bold text-primary">{refCode}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-text-muted font-semibold">Registered Email</span>
              <span className="font-semibold text-primary">{email}</span>
            </div>
          </div>

          {/* Progress Timeline */}
          <div className="space-y-3 mb-8 text-left bg-background border border-border-subtle rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold">
                ✓
              </div>
              <div>
                <p className="text-xs font-bold text-primary">Application Submitted</p>
                <p className="text-[11px] text-text-muted">Account and profile record initialized.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold animate-pulse">
                2
              </div>
              <div>
                <p className="text-xs font-bold text-primary">Medical Credential &amp; MDCN Review</p>
                <p className="text-[11px] text-text-muted">Clinical Director verifies license status (approx. 24 hours).</p>
              </div>
            </div>

            <div className="flex items-start gap-3 opacity-60">
              <div className="w-6 h-6 rounded-full bg-border-subtle text-text-muted flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold">
                3
              </div>
              <div>
                <p className="text-xs font-bold text-primary">Clinical Hub Activation</p>
                <p className="text-[11px] text-text-muted">Access doctor dashboard, triage queue, and care plans.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/login"
              className="flex-1 py-3 bg-accent hover:bg-[#0c704d] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">login</span>
              Return to Login
            </Link>
            <Link
              href="/"
              className="flex-1 py-3 bg-white border border-border-subtle hover:bg-surface-secondary text-primary rounded-xl text-xs font-bold transition-all flex items-center justify-center"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Registration Form View ────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background font-sans text-primary antialiased">
      {/* ── Left Side Branding / Imagery (Desktop) ────────── */}
      <div className="hidden md:flex md:w-1/2 relative bg-surface-secondary flex-col justify-between p-12 overflow-hidden">
        {/* Background Image */}
        <img
          className="absolute inset-0 w-full h-full object-cover object-center"
          alt="Medical Doctors Reviewing Case"
          src="/a_diverse_group_of_professional_doctors_in_a_modern_high_tech_clinical_setting..png"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111111]/90 via-[#111111]/45 to-black/30" />

        {/* Brand Top */}
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center font-black text-lg shadow-md">
            M
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-white block leading-none">
              MEDIQ
            </span>
            <span className="text-[10px] uppercase tracking-widest text-accent font-semibold">
              Clinician Network
            </span>
          </div>
        </div>

        {/* Clinician Value Card */}
        <div className="relative z-10 space-y-4 max-w-md">
          <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-5 text-white shadow-lg">
            <div className="flex items-center gap-2 text-accent text-xs font-bold uppercase tracking-wider mb-2">
              <span className="material-symbols-outlined text-[18px]">stethoscope</span>
              Physician Operating Hub
            </div>
            <p className="text-sm font-medium text-white/90 leading-relaxed">
              &ldquo;Review triage cases during dedicated clinical blocks, issue multi-drug regimens with automated alarm synchronization, and monitor chronic disease telemetry asynchronously.&rdquo;
            </p>
          </div>

          <div className="flex items-center gap-6 text-white/80 text-xs font-semibold pt-2">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-accent text-[16px]">verified</span>
              MDCN / License Verified
            </span>
            <span>&bull;</span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-accent text-[16px]">timer</span>
              SLA-Driven Queues
            </span>
          </div>
        </div>
      </div>

      {/* ── Right Side Application Form ───────────────────── */}
      <div className="w-full md:w-1/2 flex flex-col justify-center items-center px-6 py-10 md:py-14 bg-white overflow-y-auto">
        <div className="w-full max-w-[460px]">
          {/* Mobile Header Logo */}
          <div className="flex md:hidden items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm">
              M
            </div>
            <span className="text-xl font-bold tracking-tight text-primary">MEDIQ</span>
          </div>

          {/* Form Header */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-bold uppercase tracking-wider mb-2">
              <span className="material-symbols-outlined text-[14px]">local_hospital</span>
              Medical Practitioner Application
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-primary tracking-tight">
              Apply for Clinical Staff Credential
            </h1>
            <p className="text-xs md:text-sm text-text-muted mt-1">
              Join the MEDIQ hospital telehealth registry. Applications are verified by our clinical directorship.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="fullName">
                Full Name &amp; Title <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
                  <span className="material-symbols-outlined text-[18px]">badge</span>
                </span>
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Dr. Oladipo Adeleke"
                  className="w-full pl-10 pr-4 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
                />
              </div>
            </div>

            {/* Specialty & License Number Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Medical Specialty */}
              <div className="space-y-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="specialty">
                  Medical Specialty <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    id="specialty"
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full pl-3 pr-8 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs appearance-none cursor-pointer"
                  >
                    {MEDICAL_SPECIALTIES.map((spec) => (
                      <option key={spec} value={spec}>
                        {spec}
                      </option>
                    ))}
                  </select>
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-text-muted">
                    <span className="material-symbols-outlined text-[16px]">expand_more</span>
                  </span>
                </div>
              </div>

              {/* MDCN / License Number */}
              <div className="space-y-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="licenseNumber">
                  License / MDCN Reg #
                </label>
                <input
                  id="licenseNumber"
                  type="text"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="e.g. MDCN/R/48921"
                  className="w-full px-3 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
                />
              </div>
            </div>

            {/* Email Address */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="email">
                Professional Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
                  <span className="material-symbols-outlined text-[18px]">mail</span>
                </span>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="doctor@hospital.org"
                  className="w-full pl-10 pr-4 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
                />
              </div>
            </div>

            {/* Phone Number */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="phone">
                Direct Contact / Mobile Number
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
                  <span className="material-symbols-outlined text-[18px]">phone</span>
                </span>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+234 802 345 6789"
                  className="w-full pl-10 pr-4 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
                />
              </div>
            </div>

            {/* Clinical Bio / Practice Experience */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="bio">
                Clinical Experience &amp; Affiliations
              </label>
              <textarea
                id="bio"
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Hospital affiliations, years of clinical practice, specializations..."
                className="w-full p-3 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs resize-none"
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="password">
                Create Account Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full pl-10 pr-10 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-muted hover:text-primary transition-colors cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">error</span>
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 mt-4 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Submitting Clinical Application...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">assignment_turned_in</span>
                  <span>Submit Credential Application</span>
                </>
              )}
            </button>
          </form>

          {/* Navigation Links */}
          <div className="mt-6 pt-5 border-t border-border-subtle flex flex-col gap-2.5 text-center text-xs text-text-muted">
            <p>
              Already an approved doctor?{' '}
              <Link href="/login" className="text-accent font-bold hover:underline">
                Sign in to Doctor Hub
              </Link>
            </p>
            <p>
              Are you a patient?{' '}
              <Link href="/signup" className="text-primary font-bold hover:underline">
                Register as Patient
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}