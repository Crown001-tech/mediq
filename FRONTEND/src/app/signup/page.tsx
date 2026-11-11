'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { formatDoctorName } from '@/shared/utils'

function calculateAge(dobStr: string): number | null {
  if (!dobStr) return null
  const dob = new Date(dobStr)
  if (isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--
  }
  return age >= 0 && age <= 125 ? age : null
}

type InviteVerification = {
  valid: boolean
  reason?: string
  doctor_id?: string
  doctor_name?: string
  doctor_specialty?: string
  patient_name_hint?: string | null
  patient_phone_hint?: string | null
  expires_at?: string
  message?: string
}

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialCode = searchParams.get('code')?.trim().toUpperCase() || ''

  const role = 'patient'
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('Female')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Mandatory Enrollment invite code state
  const [inviteCode, setInviteCode] = useState(initialCode)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [verification, setVerification] = useState<InviteVerification | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const computedAge = calculateAge(dob)

  // Verify invite code whenever inviteCode changes
  useEffect(() => {
    if (!inviteCode.trim()) {
      setVerification(null)
      return
    }

    const clean = inviteCode.trim().toUpperCase()
    if (clean.length < 4) {
      setVerification(null)
      return
    }

    let active = true
    setVerifyingCode(true)

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/enrollments/verify?code=${encodeURIComponent(clean)}`)
        const data: InviteVerification = await res.json()
        if (active) {
          setVerification(data)
          // Pre-fill both patient name and phone number if empty
          if (data.valid) {
            if (data.patient_name_hint && !fullName) {
              setFullName(data.patient_name_hint)
            }
            if (data.patient_phone_hint && !phone) {
              setPhone(data.patient_phone_hint)
            }
          }
        }
      } catch (err) {
        console.error('Failed to verify invite code:', err)
        if (active) {
          setVerification({ valid: false, reason: 'NETWORK_ERROR' })
        }
      } finally {
        if (active) setVerifyingCode(false)
      }
    }, 350)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [inviteCode, fullName])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 1. Mandatory Enrollment Code Check
    if (!inviteCode.trim()) {
      setError('A Doctor Enrollment Code is required to create a patient account.')
      return
    }

    if (!verification?.valid) {
      if (verifyingCode) {
        setError('Please wait for the enrollment code verification to complete.')
        return
      }
      if (verification?.reason === 'ALREADY_CLAIMED') {
        setError('This enrollment code has already been registered. Please request a new code from your doctor.')
        return
      }
      if (verification?.reason === 'EXPIRED') {
        setError('This enrollment code has expired. Please request a fresh code from your doctor.')
        return
      }
      setError('Please provide a valid, active Doctor Enrollment Code.')
      return
    }

    // 2. Demographic & Credentials Check
    if (!fullName.trim() || !email.trim() || !password) {
      setError('Please fill out all required fields.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    setSubmitting(true)

    // 3. Supabase Auth signup
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
      // 4. Profile insertion with demographics
      const profilePayload: Record<string, any> = {
        id: data.user.id,
        full_name: fullName.trim(),
        role,
        phone: phone.trim() || null,
        date_of_birth: dob || null,
        age: computedAge,
        gender: gender || null,
      }

      const { error: profileError } = await supabase.from('profiles').insert(profilePayload)

      if (profileError) {
        // Fallback for un-migrated base schema
        if (profileError.message?.includes('column') || profileError.code === 'PGRST204') {
          console.warn('Extended demographic columns not yet migrated in Supabase. Inserting base profile...')
          const { error: baseError } = await supabase.from('profiles').insert({
            id: data.user.id,
            full_name: fullName.trim(),
            role,
            phone: phone.trim() || null,
          })
          if (baseError) {
            setError(baseError.message)
            setSubmitting(false)
            return
          }
        } else {
          setError(profileError.message)
          setSubmitting(false)
          return
        }
      }

      // 5. Atomically claim enrollment invite
      try {
        const claimRes = await fetch('/api/enrollments/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: inviteCode.trim().toUpperCase(),
            patient_id: data.user.id,
            patient_name: fullName.trim(),
          }),
        })

        const claimResult = await claimRes.json()
        if (claimResult.success && claimResult.doctor_id) {
          localStorage.setItem('mediq_assigned_doctor_id', claimResult.doctor_id)
          if (claimResult.doctor_name) {
            localStorage.setItem('mediq_assigned_doctor_name', claimResult.doctor_name)
          }
        } else {
          console.warn('Enrollment claim notice:', claimResult.error)
        }
      } catch (claimErr) {
        console.error('Error claiming enrollment code:', claimErr)
      }
    }

    setSubmitting(false)
    router.push('/dashboard')
  }

  return (
    <div className="w-full max-w-[470px]">
      {/* Mobile Top Brand Header */}
      <div className="flex lg:hidden flex-col items-center justify-center gap-2 mb-4 text-center">
        <Link href="/" className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white shadow-md touch-press active:scale-95 transition-transform">
          <div className="w-5 h-5 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-xs">
            M
          </div>
          <span className="text-xs font-bold tracking-tight">MEDIQ Portal</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </Link>
      </div>

      {/* Frosted Glass Card Container */}
      <div className="bg-white/[0.94] backdrop-blur-2xl border border-white/60 shadow-[0_25px_60px_rgba(0,0,0,0.45)] rounded-3xl p-6 sm:p-8 relative overflow-hidden ring-1 ring-black/5 animate-card-entrance">
        {/* Top Glowing Gradient Accent Strip */}
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />

        {/* Mobile Touch Indicator Pill */}
        <div className="w-10 h-1 bg-accent/40 rounded-full mx-auto mb-4 block sm:hidden" />

        {/* Form Header */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-bold text-primary tracking-tight">
              Patient Sign Up
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Verified Care
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Enter the invite code from your doctor to create your account.
          </p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
        {/* Invite Code Input */}
        <div className="p-3.5 bg-surface-secondary/40 border border-border-subtle rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="inviteCode" className="block text-xs font-bold uppercase tracking-wider text-primary">
              Doctor&apos;s Invite Code <span className="text-red-500">*</span>
            </label>
            <span className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Required</span>
          </div>

          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
              <span className="material-symbols-outlined text-[18px]">vpn_key</span>
            </span>
            <input
              id="inviteCode"
              type="text"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="e.g. MED-7842"
              maxLength={12}
              className="input-focus-touch w-full pl-10 pr-10 py-2.5 bg-white border border-border-subtle rounded-xl text-sm font-mono font-bold tracking-wider text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent uppercase transition-all shadow-xs"
            />
            {verifyingCode && (
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Verification Status Feedback Banner */}
          {inviteCode.trim() && verification && (
            <div className="pt-1">
              {verification.valid ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs text-emerald-800 animate-in fade-in duration-150">
                  <span className="material-symbols-outlined text-emerald-600 text-[18px] shrink-0">
                    verified
                  </span>
                  <div>
                    <p className="font-bold text-emerald-900">
                      Doctor: {formatDoctorName(verification.doctor_name)}
                    </p>
                    {verification.doctor_specialty && (
                      <p className="text-[11px] text-emerald-700">
                        {verification.doctor_specialty}
                      </p>
                    )}
                  </div>
                </div>
              ) : verification.reason === 'ALREADY_CLAIMED' ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800">
                  <span className="material-symbols-outlined text-amber-600 text-[18px] shrink-0">
                    warning
                  </span>
                  <p>This code was already used. Please request a new one from your doctor.</p>
                </div>
              ) : verification.reason === 'EXPIRED' ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700">
                  <span className="material-symbols-outlined text-red-600 text-[18px] shrink-0">
                    event_busy
                  </span>
                  <p>This code has expired. Please ask your doctor for a new code.</p>
                </div>
              ) : (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700">
                  <span className="material-symbols-outlined text-red-600 text-[18px] shrink-0">
                    search_off
                  </span>
                  <span>Code not found. Please check and try again.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Full Name */}
        <div className="space-y-1">
          <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="fullName">
            Full Name <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
              <span className="material-symbols-outlined text-[18px]">person</span>
            </span>
            <input
              id="fullName"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Amina Bello"
              className="input-focus-touch w-full pl-10 pr-4 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
            />
          </div>
        </div>

        {/* Email Address */}
        <div className="space-y-1">
          <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="email">
            Email Address <span className="text-red-500">*</span>
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
              placeholder="amina@example.com"
              className="input-focus-touch w-full pl-10 pr-4 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
            />
          </div>
        </div>

        {/* Phone Number */}
        <div className="space-y-1">
          <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="phone">
            Phone Number (WhatsApp / Mobile)
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
              placeholder="+234 803 123 4567"
              className="input-focus-touch w-full pl-10 pr-4 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
            />
          </div>
        </div>

        {/* Demographics Grid: Date of Birth, Auto-Calculated Age & Gender */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Date of Birth & Auto Age */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="dob">
                Date of Birth
              </label>
              {computedAge !== null && (
                <span className="text-[11px] font-bold text-accent bg-accent/10 px-2 py-0.2 rounded-full">
                  {computedAge} yrs old
                </span>
              )}
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
                <span className="material-symbols-outlined text-[16px]">calendar_today</span>
              </span>
              <input
                id="dob"
                type="date"
                value={dob}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDob(e.target.value)}
                className="input-focus-touch w-full pl-9 pr-3 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs cursor-pointer"
              />
            </div>
          </div>

          {/* Gender Dropdown */}
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="gender">
              Gender
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
                <span className="material-symbols-outlined text-[16px]">wc</span>
              </span>
              <select
                id="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="input-focus-touch w-full pl-9 pr-8 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs appearance-none cursor-pointer"
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </select>
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-text-muted">
                <span className="material-symbols-outlined text-[16px]">expand_more</span>
              </span>
            </div>
          </div>
        </div>

        {/* Password with Show/Hide Toggle */}
        <div className="space-y-1 pt-1">
          <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="password">
            Password <span className="text-red-500">*</span>
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
              className="input-focus-touch w-full pl-10 pr-10 py-2.5 bg-surface-secondary/50 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-xs"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="touch-press absolute inset-y-0 right-0 pr-3 flex items-center text-text-muted hover:text-primary active:scale-90 transition-transform cursor-pointer"
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              <span className="material-symbols-outlined text-[18px]">
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{error}</span>
          </div>
        )}

        {/* Submit Button with Touch Sheen */}
        <button
          type="submit"
          disabled={submitting || (inviteCode.trim().length > 0 && verification !== null && !verification.valid)}
          className="btn-sheen touch-press w-full py-3.5 mt-4 bg-accent hover:bg-[#0c704d] active:scale-[0.96] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-accent/25 flex items-center justify-center gap-2 cursor-pointer select-none"
        >
          {submitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Registering Patient...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
              <span>Enroll &amp; Connect to Doctor</span>
            </>
          )}
        </button>
      </form>

      {/* Information for patients without a code */}
      <div className="mt-4 p-3 bg-surface-secondary/40 border border-border-subtle rounded-xl text-center text-[11px] text-text-muted">
        Don&apos;t have a code? Ask your hospital doctor or clinic receptionist to generate a MEDIQ follow-up invite code.
      </div>

      {/* Navigation Links */}
      <div className="mt-5 pt-4 border-t border-border-subtle flex flex-col gap-2 text-center text-xs text-text-muted">
        <p>
          Already enrolled?{' '}
          <Link href="/login" className="text-accent font-bold hover:underline touch-press active:opacity-70">
            Sign in to your portal
          </Link>
        </p>
        <p>
          Are you a licensed medical practitioner?{' '}
          <Link href="/doctor-apply" className="text-primary font-bold hover:underline touch-press active:opacity-70">
            Apply for Clinical Staff Credential
          </Link>
        </p>
      </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 sm:p-6 lg:p-10 font-sans text-primary antialiased overflow-x-hidden">
      {/* ── 1. Full-Screen Photographic Clinical Background ─────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          className="w-full h-full object-cover object-center scale-[1.03] transition-transform duration-1000 ease-out"
          alt="Healthcare professionals"
          src="/a_diverse_group_of_professional_doctors_in_a_modern_high_tech_clinical_setting..png"
        />
        {/* Dark Emerald Multi-Stop Vignette Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#06140f]/92 via-[#081813]/85 to-[#040806]/92 backdrop-blur-[2.5px]" />

        {/* Ambient Glowing Orbs */}
        <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-emerald-500/20 blur-[120px] pointer-events-none animate-float-slow animate-pulse-glow" />
        <div className="absolute -bottom-32 -right-32 w-[480px] h-[480px] rounded-full bg-teal-400/15 blur-[120px] pointer-events-none animate-float-reverse animate-pulse-glow" />
      </div>

      {/* ── 2. Interactive Content Container ────────────────────────── */}
      <div className="relative z-10 w-full max-w-5xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-12 py-6">
        
        {/* ── Desktop Brand Showcase (Left Side - Clean & Focused) ─────── */}
        <div className="hidden lg:flex flex-col justify-between max-w-md space-y-6 text-white">
          {/* Brand Crest */}
          <Link href="/" className="flex items-center gap-3 w-fit group cursor-pointer touch-press">
            <div className="w-12 h-12 rounded-2xl bg-accent text-white flex items-center justify-center font-black text-xl shadow-lg shadow-accent/30 border border-white/20 group-hover:scale-105 group-hover:rotate-2 transition-transform">
              M
            </div>
            <div>
              <span className="text-2xl font-bold tracking-tight text-white block leading-none">
                MEDIQ
              </span>
              <span className="text-[11px] uppercase tracking-widest text-emerald-400 font-bold mt-1 block">
                Clinical Health System
              </span>
            </div>
          </Link>

          {/* Punchy Heading */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs text-white/90">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Direct Doctor Registration</span>
            </div>
            <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight leading-tight text-white drop-shadow-sm">
              Direct Clinical Care, <br />
              <span className="text-emerald-300">Direct from Your Doctor.</span>
            </h1>
            <p className="text-xs xl:text-sm text-white/75 leading-relaxed">
              Enter your doctor&apos;s follow-up invite code to activate your patient hub, doses, and care regimens.
            </p>
          </div>

          {/* Tactile Micro-Feature Badges (Clean, Minimal, Animated) */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/15 hover:border-emerald-400/40 touch-press transition-all duration-200 group">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 border border-emerald-400/30 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[19px]">verified</span>
              </div>
              <div>
                <p className="text-xs font-bold text-white">Doctor-Verified Enrollment</p>
                <p className="text-[11px] text-white/70">Seamless link to your hospital physician</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/15 hover:border-emerald-400/40 touch-press transition-all duration-200 group">
              <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0 border border-teal-400/30 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[19px]">prescriptions</span>
              </div>
              <div>
                <p className="text-xs font-bold text-white">Personalized Care Regimens</p>
                <p className="text-[11px] text-white/70">Access instructions, prescriptions &amp; alarms</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/15 hover:border-emerald-400/40 touch-press transition-all duration-200 group">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0 border border-cyan-400/30 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[19px]">lock</span>
              </div>
              <div>
                <p className="text-xs font-bold text-white">Confidential &amp; Encrypted</p>
                <p className="text-[11px] text-white/70">NDPR &amp; HIPAA clinical grade protection</p>
              </div>
            </div>
          </div>

          {/* Trust Reassurance Strip */}
          <div className="flex items-center gap-4 text-white/70 text-[11px] font-semibold pt-1">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-400 text-[15px]">lock</span>
              NDPR &amp; HIPAA Compliant
            </span>
            <span>&bull;</span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-400 text-[15px]">verified_user</span>
              Attending Physician Linked
            </span>
          </div>
        </div>

        {/* ── Glassmorphic Sign Up Card (Mobile & Desktop) ─────────── */}
        <div className="w-full lg:w-[480px] shrink-0">
          <Suspense
            fallback={
              <div className="w-full max-w-[480px] py-16 flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-xl rounded-3xl border border-white/40 shadow-xl">
                <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-text-muted">Loading registration portal...</p>
              </div>
            }
          >
            <SignupForm />
          </Suspense>
        </div>

      </div>
    </div>
  )
}