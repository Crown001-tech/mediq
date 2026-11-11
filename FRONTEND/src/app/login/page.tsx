'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, syncAuthCookie, clearAuthCookie } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [alert, setAlert] = useState<{
    type: 'error' | 'pending' | 'rejected'
    title: string
    message: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const errorParam = params.get('error')
      if (errorParam === 'pending_verification') {
        setAlert({
          type: 'pending',
          title: 'Verification Pending',
          message: 'Your medical staff credential application is currently pending verification by our Clinical Director. Full access will be granted once approved.',
        })
      } else if (errorParam === 'unauthorized') {
        setAlert({
          type: 'error',
          title: 'Access Restricted',
          message: 'You do not have administrative authorization to access that section.',
        })
      }
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAlert(null)

    if (!email.trim() || !password) {
      setAlert({
        type: 'error',
        title: 'Missing Fields',
        message: 'Please provide both email and password.',
      })
      return
    }

    setLoading(true)

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (loginError) {
      setAlert({
        type: 'error',
        title: 'Sign In Failed',
        message: loginError.message,
      })
      setLoading(false)
      return
    }

    if (data.session?.access_token) {
      syncAuthCookie(data.session.access_token)
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, verified')
        .eq('id', data.user.id)
        .maybeSingle()

      if (!profile || profile.role === 'rejected') {
        clearAuthCookie()
        setAlert({
          type: 'rejected',
          title: 'Application Declined',
          message:
            'Your medical practitioner application was reviewed by the Clinical Directorate and has been rejected. If you believe this is an error or wish to submit additional credentials, contact support@mediq.health.',
        })
        await supabase.auth.signOut()
        setLoading(false)
        return
      }

      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
      const nextUrl = params?.get('next')

      if (profile.role === 'admin') {
        router.push(nextUrl?.startsWith('/admin') ? nextUrl : '/admin')
      } else if (profile.role === 'doctor') {
        if (!profile.verified) {
          clearAuthCookie()
          setAlert({
            type: 'pending',
            title: 'Application Under Review',
            message:
              'Your medical application is currently pending verification by our Clinical Director. You will receive access once approved.',
          })
          await supabase.auth.signOut()
          setLoading(false)
          return
        }
        router.push(nextUrl?.startsWith('/doctor') ? nextUrl : '/doctor/dashboard')
      } else {
        const isRestrictedTarget = nextUrl?.startsWith('/admin') || nextUrl?.startsWith('/doctor')
        router.push(nextUrl && !isRestrictedTarget ? nextUrl : '/dashboard')
      }
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 sm:p-6 lg:p-10 font-sans text-primary antialiased overflow-x-hidden">
      {/* ── 1. Full-Screen Photographic Clinical Background ─────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          className="w-full h-full object-cover object-center scale-[1.03] transition-transform duration-1000 ease-out"
          alt="Healthcare professionals"
          src="/high_quality_professional_medical_photography_for_a_telehealth_app._a_clean.png"
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
              <span>Telehealth Network Online</span>
            </div>
            <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight leading-tight text-white drop-shadow-sm">
              Continuous Care, <br />
              <span className="text-emerald-300">Direct to Your Physician.</span>
            </h1>
            <p className="text-xs xl:text-sm text-white/75 leading-relaxed">
              Manage active care plans, communicate with your attending doctor, and maintain prescribed routines.
            </p>
          </div>

          {/* Tactile Micro-Feature Badges (Clean, Minimal, Animated) */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/15 hover:border-emerald-400/40 touch-press transition-all duration-200 group">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 border border-emerald-400/30 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[19px]">medical_services</span>
              </div>
              <div>
                <p className="text-xs font-bold text-white">Attending Physician Linked</p>
                <p className="text-[11px] text-white/70">Direct care thread &amp; post-visit monitoring</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/15 hover:border-emerald-400/40 touch-press transition-all duration-200 group">
              <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0 border border-teal-400/30 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[19px]">alarm_on</span>
              </div>
              <div>
                <p className="text-xs font-bold text-white">Smart Dose Alarms</p>
                <p className="text-[11px] text-white/70">Scheduled daily medication notifications</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/15 hover:border-emerald-400/40 touch-press transition-all duration-200 group">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0 border border-cyan-400/30 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[19px]">verified_user</span>
              </div>
              <div>
                <p className="text-xs font-bold text-white">End-to-End Encrypted</p>
                <p className="text-[11px] text-white/70">NDPR &amp; HIPAA clinical grade security</p>
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
              <span className="material-symbols-outlined text-emerald-400 text-[15px]">verified</span>
              Official Care Portals
            </span>
          </div>
        </div>

        {/* ── Glassmorphic Sign In Card (Mobile & Desktop) ─────────── */}
        <div className="w-full lg:w-[450px] shrink-0">
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

          {/* Frosted Glass Card */}
          <div className="bg-white/[0.94] backdrop-blur-2xl border border-white/60 shadow-[0_25px_60px_rgba(0,0,0,0.45)] rounded-3xl p-6 sm:p-8 relative overflow-hidden ring-1 ring-black/5 animate-card-entrance">
            {/* Top Glowing Gradient Accent Strip */}
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />

            {/* Mobile Touch Indicator Pill */}
            <div className="w-10 h-1 bg-accent/40 rounded-full mx-auto mb-4 block sm:hidden" />

            {/* Card Header */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-2xl font-bold text-primary tracking-tight">
                  Sign In
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  Clinical Secure
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Access your patient consultations, care plans, or clinical doctor hub.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
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
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. yourname@example.com"
                    disabled={loading}
                    className="input-focus-touch w-full pl-10 pr-4 py-2.5 bg-surface-secondary/60 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-2xs disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted" htmlFor="password">
                    Password <span className="text-red-500">*</span>
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
                    <span className="material-symbols-outlined text-[18px]">lock</span>
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    disabled={loading}
                    className="input-focus-touch w-full pl-10 pr-10 py-2.5 bg-surface-secondary/60 border border-border-subtle rounded-xl text-xs font-medium text-primary placeholder:text-text-muted/60 focus:bg-white focus:outline-none focus:border-accent transition-all shadow-2xs disabled:opacity-60"
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

              {/* Structured Alert Message (Error / Pending / Rejected) */}
              {alert && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 shadow-xs animate-in fade-in duration-200 ${
                    alert.type === 'rejected'
                      ? 'bg-red-50/90 border-red-200 text-red-900'
                      : alert.type === 'pending'
                      ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      alert.type === 'rejected'
                        ? 'bg-red-100 text-red-700'
                        : alert.type === 'pending'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-600'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {alert.type === 'rejected'
                        ? 'cancel'
                        : alert.type === 'pending'
                        ? 'hourglass_top'
                        : 'error'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-xs uppercase tracking-wider mb-0.5">
                      {alert.title}
                    </p>
                    <p className="text-xs leading-relaxed opacity-90">
                      {alert.message}
                    </p>
                  </div>
                </div>
              )}

              {/* Submit Button with Micro-Interaction & Touch Sheen */}
              <button
                type="submit"
                disabled={loading}
                className="btn-sheen touch-press w-full py-3.5 mt-4 bg-accent hover:bg-[#0c704d] active:scale-[0.96] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-accent/25 flex items-center justify-center gap-2 cursor-pointer select-none"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">login</span>
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </form>

            {/* Navigation Links */}
            <div className="mt-7 pt-4 border-t border-border-subtle flex flex-col gap-2.5 text-center text-xs text-text-muted">
              <p>
                New patient?{' '}
                <Link href="/signup" className="text-accent font-bold hover:underline touch-press active:opacity-70">
                  Create a patient account
                </Link>
              </p>
              <p>
                Are you a medical practitioner?{' '}
                <Link href="/doctor-apply" className="text-primary font-bold hover:underline touch-press active:opacity-70">
                  Apply for Clinical Staff Credential
                </Link>
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}