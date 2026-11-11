'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'

/* ═══════════════════════════════════════════════════════════════════ */
/*  TYPEWRITER HOOK                                                   */
/* ═══════════════════════════════════════════════════════════════════ */
function useTypewriter(phrases: string[], typingSpeed = 80, deletingSpeed = 40, pause = 2200) {
  const [text, setText] = useState('')
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    const current = phrases[phraseIndex]
    let timeout: NodeJS.Timeout

    if (!isDeleting && text === current) {
      timeout = setTimeout(() => setIsDeleting(true), pause)
    } else if (isDeleting && text === '') {
      setIsDeleting(false)
      setPhraseIndex((prev) => (prev + 1) % phrases.length)
    } else {
      timeout = setTimeout(() => {
        setText(current.substring(0, text.length + (isDeleting ? -1 : 1)))
      }, isDeleting ? deletingSpeed : typingSpeed)
    }

    return () => clearTimeout(timeout)
  }, [text, phraseIndex, isDeleting, phrases, typingSpeed, deletingSpeed, pause])

  return text
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  SCROLL REVEAL HOOK                                                */
/* ═══════════════════════════════════════════════════════════════════ */
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add('is-visible')
      }),
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    )
    el.querySelectorAll('.scroll-reveal').forEach((c) => obs.observe(c))
    return () => obs.disconnect()
  }, [])
  return ref
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  COUNT UP HOOK                                                     */
/* ═══════════════════════════════════════════════════════════════════ */
function useCountUp(end: number, duration = 2000, trigger = false) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!trigger) return
    let start = 0
    const step = end / (duration / 16)
    const id = setInterval(() => {
      start += step
      if (start >= end) { setCount(end); clearInterval(id) }
      else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(id)
  }, [end, duration, trigger])
  return count
}

function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true) },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  TESTIMONIAL SLIDER                                                */
/* ═══════════════════════════════════════════════════════════════════ */
const testimonials = [
  {
    quote: 'MEDIQ eliminated the 3-hour hospital wait for me. I submitted my case at night and had my prescription by morning. The care plan tracking changed how I manage my health entirely.',
    name: 'Adaeze Okonkwo',
    title: 'Patient — Lagos, Nigeria',
    image: '/patient_app.jpg',
  },
  {
    quote: 'The doctor queue system is remarkably efficient. I can triage, diagnose, and create care plans asynchronously — and my patients actually follow through on their medications now.',
    name: 'Dr. Emeka Nwankwo',
    title: 'General Practitioner — Abuja',
    image: '/doctor_portrait.jpg',
  },
  {
    quote: 'My medication adherence improved from 40% to 95% within two months. The smart reminders and urgency escalation feature genuinely gave me peace of mind about my chronic condition.',
    name: 'Fatima Hassan',
    title: 'Patient — Abuja, Nigeria',
    image: '/patient_care.jpg',
  },
]

function TestimonialSlider() {
  const [active, setActive] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const startAutoPlay = useCallback(() => {
    intervalRef.current = setInterval(() => {
      setActive((prev) => (prev + 1) % testimonials.length)
    }, 6000)
  }, [])

  useEffect(() => {
    startAutoPlay()
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [startAutoPlay])

  const goTo = (i: number) => {
    setActive(i)
    if (intervalRef.current) clearInterval(intervalRef.current)
    startAutoPlay()
  }

  const t = testimonials[active]

  return (
    <div className="relative">
      {/* Main Testimonial */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 min-h-[480px] lg:min-h-[520px]">
        {/* Image Side */}
        <div className="lg:col-span-2 relative overflow-hidden">
          {testimonials.map((item, i) => (
            <div
              key={i}
              className="absolute inset-0 transition-all duration-700 ease-out"
              style={{
                opacity: i === active ? 1 : 0,
                transform: i === active ? 'scale(1)' : 'scale(1.05)',
              }}
            >
              <Image
                src={item.image}
                alt={item.name}
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#f7faf9] lg:block hidden" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#f7faf9] to-transparent lg:hidden" />
            </div>
          ))}
        </div>

        {/* Content Side */}
        <div className="lg:col-span-3 flex items-center px-8 sm:px-12 lg:px-16 py-12 lg:py-0 bg-[#f7faf9]">
          <div className="max-w-lg">
            {/* Quote Icon */}
            <svg className="w-10 h-10 text-accent/20 mb-6" viewBox="0 0 40 40" fill="currentColor">
              <path d="M12 22c-3.3 0-6-2.7-6-6V8h12v8h-6c0 3.3 2.7 6 6 6v4c-3.3 0-6-2.7-6-4zm16 0c-3.3 0-6-2.7-6-6V8h12v8h-6c0 3.3 2.7 6 6 6v4c-3.3 0-6-2.7-6-4z" />
            </svg>

            <p
              className="text-xl sm:text-2xl lg:text-[1.65rem] text-primary font-medium leading-relaxed mb-8 transition-all duration-500"
              key={active}
              style={{ animation: 'fadeInUp 0.6s ease both' }}
            >
              &ldquo;{t.quote}&rdquo;
            </p>

            <div
              className="transition-all duration-500"
              key={`info-${active}`}
              style={{ animation: 'fadeInUp 0.6s ease 0.15s both' }}
            >
              <p className="text-base font-bold text-primary">{t.name}</p>
              <p className="text-sm text-text-muted mt-1">{t.title}</p>
            </div>

            {/* Indicators */}
            <div className="flex items-center gap-3 mt-10">
              {testimonials.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`transition-all duration-500 rounded-full cursor-pointer ${
                    i === active
                      ? 'w-10 h-1.5 bg-accent'
                      : 'w-1.5 h-1.5 bg-primary/15 hover:bg-primary/30'
                  }`}
                  aria-label={`Go to testimonial ${i + 1}`}
                />
              ))}
              <span className="text-[11px] text-text-muted ml-4 font-semibold tabular-nums">
                {String(active + 1).padStart(2, '0')} / {String(testimonials.length).padStart(2, '0')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  MAIN PAGE                                                        */
/* ═══════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const typedText = useTypewriter([
    'Personalized Care Plans',
    'Verified Physicians',
    'Smart Dose Tracking',
    'Async Consultations',
    'Continuous Monitoring',
  ])

  const servicesRef = useScrollReveal()
  const processRef = useScrollReveal()
  const whyRef = useScrollReveal()
  const ctaRef = useScrollReveal()

  const statsSection = useInView(0.25)
  const patients = useCountUp(12400, 2400, statsSection.visible)
  const doctors = useCountUp(340, 2000, statsSection.visible)
  const cases = useCountUp(58000, 2600, statsSection.visible)
  const satisfaction = useCountUp(98, 1800, statsSection.visible)

  const [navScrolled, setNavScrolled] = useState(false)
  useEffect(() => {
    const fn = () => setNavScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  return (
    <div className="min-h-screen bg-white font-sans text-primary antialiased overflow-x-hidden">

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  CORPORATE NAVIGATION                                       */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        navScrolled
          ? 'bg-white/95 backdrop-blur-2xl shadow-[0_1px_0_rgba(0,0,0,0.04)] py-0'
          : 'bg-transparent py-2'
      }`}>

        {/* Main Nav */}
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 flex items-center justify-between h-[68px]">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group shrink-0">
            <div className="relative">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-base transition-all duration-300 ${
                navScrolled
                  ? 'bg-accent text-white shadow-lg shadow-accent/20'
                  : 'bg-white text-accent shadow-lg shadow-black/10'
              }`}>
                M
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-white animate-pulse" />
            </div>
            <div className="leading-none">
              <span className={`text-xl font-extrabold tracking-tight block transition-colors duration-300 ${navScrolled ? 'text-primary' : 'text-white'}`}>
                MEDIQ
              </span>
              <span className={`text-[9px] uppercase tracking-[0.25em] font-bold block mt-0.5 transition-colors duration-300 ${navScrolled ? 'text-accent' : 'text-emerald-300'}`}>
                Health Systems
              </span>
            </div>
          </Link>

          {/* Center Nav */}
          <div className={`hidden lg:flex items-center gap-1 transition-colors duration-300`}>
            {[
              { label: 'Our Services', href: '#services' },
              { label: 'How It Works', href: '#process' },
              { label: 'Why MEDIQ', href: '#why-mediq' },
              { label: 'Patient Stories', href: '#stories' },
              { label: 'For Physicians', href: '/doctor-apply' },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={`relative px-5 py-2 text-[13px] font-semibold tracking-wide transition-all rounded-lg ${
                  navScrolled
                    ? 'text-text-muted hover:text-primary hover:bg-surface-secondary'
                    : 'text-white/70 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/login"
              className={`hidden md:inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold rounded-lg transition-all ${
                navScrolled
                  ? 'text-text-muted hover:text-primary hover:bg-surface-secondary'
                  : 'text-white/70 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="btn-sheen touch-press inline-flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-[#0b7a54] text-white text-[13px] font-bold rounded-lg transition-all shadow-lg shadow-accent/20 hover:shadow-accent/40"
            >
              Book a Consultation
            </Link>
          </div>
        </div>
      </nav>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  HERO — EDITORIAL CINEMATIC                                  */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="relative min-h-[100dvh] flex items-end overflow-hidden">
        {/* BG Image */}
        <div className="absolute inset-0">
          <Image src="/hero_cinematic.jpg" alt="Medical professional" fill className="object-cover object-[center_20%]" priority />
          <div className="absolute inset-0 bg-gradient-to-t from-[#010906] via-[#010906]/60 to-[#010906]/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#010906]/80 via-transparent to-transparent" />
        </div>

        {/* Content — Bottom-Anchored Editorial Layout */}
        <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12 pb-20 lg:pb-28 pt-40 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            {/* Main Headline — Spans 7 cols */}
            <div className="lg:col-span-7 space-y-6">

              <h1 className="reveal-text text-[2.5rem] sm:text-[3.5rem] lg:text-[4.25rem] xl:text-[4.75rem] font-extrabold tracking-[-0.035em] leading-[1.05] text-white">
                Redefining
                <br />
                Healthcare
                <br />
                <span className="text-emerald-300">
                  Delivery
                </span>
              </h1>

              <div className="reveal-fade h-[2px] w-20 bg-gradient-to-r from-emerald-400 to-transparent" style={{ animationDelay: '0.3s' }} />

              <p className="reveal-fade text-base sm:text-lg text-white/50 leading-relaxed max-w-md font-medium" style={{ animationDelay: '0.35s' }}>
                Africa&apos;s leading async-first telehealth platform. Connecting patients with verified physicians for{' '}
                <span className="text-emerald-300 font-semibold">{typedText}</span>
                <span className="inline-block w-[2px] h-[1.1em] bg-emerald-400 ml-0.5 align-middle animate-pulse" />
              </p>
            </div>

            {/* Right Side — CTA + Stats */}
            <div className="lg:col-span-5 lg:pl-8 space-y-8">
              {/* CTA Buttons */}
              <div className="reveal-fade flex flex-col sm:flex-row gap-3" style={{ animationDelay: '0.4s' }}>
                <Link
                  href="/signup"
                  className="btn-sheen touch-press group inline-flex items-center justify-center gap-3 px-8 py-4 bg-accent hover:bg-[#0b7a54] text-white text-[15px] font-bold rounded-lg transition-all shadow-[0_0_50px_rgba(15,138,95,0.25)] hover:shadow-[0_0_70px_rgba(15,138,95,0.4)]"
                >
                  <span>Start Your Care</span>
                  <span className="material-symbols-outlined text-[20px] group-hover:translate-x-1 transition-transform">east</span>
                </Link>
                <Link
                  href="/login"
                  className="touch-press inline-flex items-center justify-center gap-2 px-7 py-4 bg-white/[0.06] hover:bg-white/[0.1] backdrop-blur border border-white/[0.1] hover:border-white/[0.2] text-white text-[15px] font-semibold rounded-lg transition-all"
                >
                  Physician Login
                </Link>
              </div>

              {/* Quick Stats Row */}
              <div className="reveal-fade grid grid-cols-3 gap-6 pt-4 border-t border-white/[0.06]" style={{ animationDelay: '0.55s' }}>
                {[
                  { num: '12K+', label: 'Patients Served' },
                  { num: '340+', label: 'Verified Doctors' },
                  { num: '<2hrs', label: 'Avg. Response' },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">{s.num}</p>
                    <p className="text-[10px] text-white/35 font-semibold uppercase tracking-[0.15em] mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-white/25">
          <span className="text-[9px] uppercase tracking-[0.3em] font-bold">Scroll</span>
          <div className="w-5 h-8 border border-white/20 rounded-full flex justify-center pt-1.5">
            <div className="w-1 h-2 bg-white/40 rounded-full animate-bounce" />
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  TRUST BAR                                                   */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="bg-[#f7faf9] border-b border-border-subtle/30">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 py-8 flex flex-wrap items-center justify-between gap-6">
          {[
            { icon: 'verified_user', text: 'NDPR Compliant' },
            { icon: 'lock', text: 'HIPAA Certified' },
            { icon: 'encrypted', text: 'End-to-End Encrypted' },
            { icon: 'shield', text: 'SOC 2 Type II' },
            { icon: 'workspace_premium', text: 'ISO 27001' },
          ].map((badge) => (
            <div key={badge.text} className="flex items-center gap-2.5 text-text-muted/60">
              <span className="material-symbols-outlined text-[18px] text-accent/40">{badge.icon}</span>
              <span className="text-xs font-bold uppercase tracking-[0.12em]">{badge.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  OUR SERVICES — Editorial Split Sections                     */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section id="services" className="py-24 lg:py-32 bg-white" ref={servicesRef}>
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          {/* Section Eyebrow */}
          <div className="scroll-reveal mb-20 max-w-xl">
            <p className="text-accent text-[13px] font-bold uppercase tracking-[0.2em] mb-4">Our Services</p>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold tracking-[-0.02em] text-primary leading-[1.15]">
              Comprehensive care,<br />delivered differently.
            </h2>
            <div className="h-[2px] w-16 bg-accent mt-6" />
          </div>

          {/* Service 1 — Full Width Image + Overlay */}
          <div className="scroll-reveal mb-8">
            <div className="relative rounded-2xl overflow-hidden group cursor-pointer h-[400px] lg:h-[520px]">
              <Image
                src="/team_collaborative.jpg"
                alt="Clinical team analyzing patient data"
                fill
                className="object-cover transition-transform duration-[1.2s] group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#010906]/90 via-[#010906]/30 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-12 lg:p-16">
                <div className="max-w-xl">
                  <p className="text-emerald-300 text-[11px] font-bold uppercase tracking-[0.25em] mb-3">Async-First Consultations</p>
                  <h3 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-tight mb-4">
                    No waiting rooms.<br />No wasted hours.
                  </h3>
                  <p className="text-white/50 text-sm sm:text-base leading-relaxed max-w-md">
                    Submit your case with photos, notes, and context. A verified physician reviews and responds — on a timeline that respects your life.
                  </p>
                  <div className="flex items-center gap-2 mt-6 text-emerald-400 text-sm font-semibold group-hover:gap-4 transition-all">
                    <span>Learn More</span>
                    <span className="material-symbols-outlined text-[18px]">east</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Service 2 & 3 — Two Column Split */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Smart Care Plans */}
            <div className="scroll-reveal relative rounded-2xl overflow-hidden group cursor-pointer h-[380px] lg:h-[420px]" style={{ transitionDelay: '0.1s' }}>
              <Image
                src="/patient_care.jpg"
                alt="Doctor with patient reviewing care plan"
                fill
                className="object-cover transition-transform duration-[1.2s] group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#010906]/90 via-[#010906]/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-10">
                <p className="text-emerald-300 text-[11px] font-bold uppercase tracking-[0.25em] mb-3">Smart Care Plans</p>
                <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-tight mb-3">
                  Personalized treatment, tracked and optimized.
                </h3>
                <p className="text-white/50 text-sm leading-relaxed max-w-sm">
                  Medication schedules, dose tracking, adherence scoring, and refill alerts — built into every care plan.
                </p>
                <div className="flex items-center gap-2 mt-5 text-emerald-400 text-sm font-semibold group-hover:gap-4 transition-all">
                  <span>Learn More</span>
                  <span className="material-symbols-outlined text-[18px]">east</span>
                </div>
              </div>
            </div>

            {/* Continuous Monitoring */}
            <div className="scroll-reveal relative rounded-2xl overflow-hidden group cursor-pointer h-[380px] lg:h-[420px]" style={{ transitionDelay: '0.2s' }}>
              <div className="absolute inset-0 bg-[#06150f]" />
              <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #0F8A5F 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

              {/* Decorative Monitor Graphic */}
              <div className="absolute top-10 right-10 w-[200px] h-[140px] bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 hidden lg:block">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Live Vitals</span>
                </div>
                <div className="flex items-end gap-[3px] h-[60px]">
                  {[35, 55, 40, 70, 50, 65, 80, 55, 70, 85, 45, 60, 75, 50, 65].map((h, i) => (
                    <div key={i} className="flex-1 bg-gradient-to-t from-emerald-500/60 to-emerald-300/20 rounded-[2px]" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-10">
                <p className="text-emerald-300 text-[11px] font-bold uppercase tracking-[0.25em] mb-3">Continuous Monitoring</p>
                <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-tight mb-3">
                  Real-time vitals.<br />Automated escalation.
                </h3>
                <p className="text-white/50 text-sm leading-relaxed max-w-sm">
                  Log vitals, track symptoms over time, and receive automated urgency escalation when your physician needs to intervene.
                </p>
                <div className="flex items-center gap-2 mt-5 text-emerald-400 text-sm font-semibold group-hover:gap-4 transition-all">
                  <span>Learn More</span>
                  <span className="material-symbols-outlined text-[18px]">east</span>
                </div>
              </div>
            </div>
          </div>

          {/* Service 4 — Narrow Horizontal Bar */}
          <div className="scroll-reveal grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ transitionDelay: '0.15s' }}>
            {[
              { icon: 'encrypted', title: 'Clinical-Grade Security', desc: 'End-to-end encrypted communications. NDPR & HIPAA compliant infrastructure.' },
              { icon: 'groups_3', title: 'Multi-Role Portals', desc: 'Dedicated dashboards for patients, doctors, and administrators.' },
              { icon: 'event_available', title: 'Intelligent Scheduling', desc: 'Book follow-ups with real-time availability and smart conflict detection.' },
            ].map((item) => (
              <div key={item.title} className="group flex items-start gap-5 p-7 rounded-xl bg-[#f7faf9] hover:bg-[#eef5f2] transition-colors cursor-pointer border border-transparent hover:border-accent/10">
                <div className="w-12 h-12 rounded-xl bg-accent/8 flex items-center justify-center shrink-0 group-hover:bg-accent/12 transition-colors">
                  <span className="material-symbols-outlined text-accent text-[22px]">{item.icon}</span>
                </div>
                <div>
                  <h4 className="text-[15px] font-bold text-primary mb-1.5">{item.title}</h4>
                  <p className="text-sm text-text-muted leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  PARALLAX IMAGE DIVIDER                                      */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="relative h-[400px] lg:h-[500px] overflow-hidden">
        <div className="absolute inset-0" style={{ transform: 'translateZ(0)' }}>
          <Image
            src="/parallax_campus.jpg"
            alt="Modern hospital campus at twilight"
            fill
            className="object-cover"
            style={{ objectPosition: 'center 40%' }}
          />
          <div className="absolute inset-0 bg-[#010906]/60" />
        </div>
        <div className="relative z-10 h-full flex items-center justify-center text-center px-6">
          <div className="max-w-2xl">
            <p className="text-emerald-300 text-[11px] font-bold uppercase tracking-[0.3em] mb-5">Our Commitment</p>
            <p className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Where world-class medical expertise meets{' '}
              <span className="text-emerald-300">human-centered technology.</span>
            </p>
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  HOW IT WORKS — Numbered Process                             */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section id="process" className="py-24 lg:py-32 bg-white" ref={processRef}>
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <div className="scroll-reveal mb-20 max-w-xl">
            <p className="text-accent text-[13px] font-bold uppercase tracking-[0.2em] mb-4">How It Works</p>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold tracking-[-0.02em] text-primary leading-[1.15]">
              Your care journey,<br />simplified.
            </h2>
            <div className="h-[2px] w-16 bg-accent mt-6" />
          </div>

          {/* Process Steps */}
          <div className="space-y-0">
            {[
              { num: '01', title: 'Create Your Account', desc: 'Sign up in under 60 seconds. Patients or physicians — each gets a tailored experience from the first login.', image: '/patient_app.jpg' },
              { num: '02', title: 'Submit Your Case', desc: 'Describe your symptoms with text, photos, and voice notes. Set your urgency level and any relevant medical history.', image: '/hero_cinematic.jpg' },
              { num: '03', title: 'Physician Review', desc: 'A verified, credentialed physician reviews your case and provides a diagnosis, care plan, and recommended treatment — usually within 2 hours.', image: '/doctor_portrait.jpg' },
              { num: '04', title: 'Follow Your Care Plan', desc: 'Receive a personalized medication schedule, track your adherence with smart reminders, and communicate directly with your attending physician.', image: '/patient_care.jpg' },
            ].map((step, i) => (
              <div
                key={step.num}
                className={`scroll-reveal grid grid-cols-1 lg:grid-cols-2 gap-0 items-stretch border-t border-border-subtle/40 ${i === 3 ? 'border-b' : ''}`}
                style={{ transitionDelay: `${i * 0.08}s` }}
              >
                {/* Content Side */}
                <div className={`flex items-center py-12 lg:py-16 ${i % 2 === 1 ? 'lg:order-2' : ''}`}>
                  <div className={`${i % 2 === 1 ? 'lg:pl-16' : 'lg:pr-16'} max-w-lg`}>
                    <span className="text-6xl lg:text-7xl font-extrabold text-accent/[0.07] block leading-none mb-4 select-none">{step.num}</span>
                    <h3 className="text-xl sm:text-2xl font-extrabold text-primary tracking-tight mb-4">{step.title}</h3>
                    <p className="text-text-muted text-[15px] leading-relaxed">{step.desc}</p>
                  </div>
                </div>

                {/* Image Side */}
                <div className={`relative h-[300px] lg:h-auto overflow-hidden ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
                  <Image
                    src={step.image}
                    alt={step.title}
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  STATS SECTION                                               */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section ref={statsSection.ref} className="py-20 lg:py-24 bg-[#06150f] relative overflow-hidden">
        <div className="absolute inset-0 noise-overlay" />
        <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-10 gap-x-8">
            {[
              { value: patients, suffix: '+', label: 'Active Patients', sub: 'and growing daily' },
              { value: doctors, suffix: '+', label: 'Verified Physicians', sub: 'credentialed & vetted' },
              { value: cases, suffix: '+', label: 'Cases Resolved', sub: 'successful outcomes' },
              { value: satisfaction, suffix: '%', label: 'Patient Satisfaction', sub: 'post-consultation' },
            ].map((stat) => (
              <div key={stat.label} className="text-center lg:text-left">
                <p className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-[-0.03em] tabular-nums">
                  {stat.value.toLocaleString()}<span className="text-emerald-400">{stat.suffix}</span>
                </p>
                <p className="text-sm text-white/60 font-bold mt-2">{stat.label}</p>
                <p className="text-[11px] text-white/25 font-medium mt-0.5 uppercase tracking-wider">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  WHY MEDIQ — Image + Content Split                           */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section id="why-mediq" className="bg-white" ref={whyRef}>
        <div className="max-w-[1400px] mx-auto">
          <div className="scroll-reveal grid grid-cols-1 lg:grid-cols-2 gap-0 items-stretch">
            {/* Image */}
            <div className="relative h-[400px] lg:h-auto min-h-[500px] overflow-hidden">
              <Image
                src="/doctor_portrait.jpg"
                alt="Distinguished physician"
                fill
                className="object-cover object-top"
              />
            </div>

            {/* Content */}
            <div className="flex items-center py-16 lg:py-24 px-8 sm:px-12 lg:px-16 xl:px-20">
              <div className="max-w-lg">
                <p className="text-accent text-[13px] font-bold uppercase tracking-[0.2em] mb-5">Why MEDIQ</p>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.02em] text-primary leading-[1.15] mb-8">
                  Healthcare built on trust, powered by technology.
                </h2>

                <div className="space-y-6">
                  {[
                    { num: '01', title: 'Verified Physicians Only', desc: 'Every doctor on MEDIQ is credentialed, background-checked, and approved by our Clinical Director before seeing patients.' },
                    { num: '02', title: 'Patient-First Design', desc: 'Every interface decision — from case submission to dose tracking — is designed around the patient experience, not the system.' },
                    { num: '03', title: 'Enterprise-Grade Infrastructure', desc: 'SOC 2 Type II audited, HIPAA & NDPR compliant, with end-to-end encryption on all patient communications.' },
                    { num: '04', title: 'Outcomes That Matter', desc: '98% patient satisfaction rate with measurable improvements in medication adherence and treatment completion.' },
                  ].map((item) => (
                    <div key={item.num} className="group flex gap-5">
                      <span className="text-[13px] font-extrabold text-accent/30 mt-0.5 shrink-0 tabular-nums">{item.num}</span>
                      <div>
                        <h4 className="text-[15px] font-bold text-primary mb-1">{item.title}</h4>
                        <p className="text-sm text-text-muted leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  TESTIMONIALS — Auto-Playing Slider                          */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section id="stories" className="bg-[#f7faf9]">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-0">
          <div className="py-16 lg:py-20 px-0 lg:px-12">
            <div className="mb-12 lg:mb-16 px-0 lg:px-0">
              <p className="text-accent text-[13px] font-bold uppercase tracking-[0.2em] mb-4">Patient Stories</p>
              <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold tracking-[-0.02em] text-primary leading-[1.15]">
                Hear from our community.
              </h2>
              <div className="h-[2px] w-16 bg-accent mt-6" />
            </div>
          </div>
        </div>
        <TestimonialSlider />
      </section>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  CTA SECTION                                                 */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="relative py-28 lg:py-36 overflow-hidden" ref={ctaRef}>
        <div className="absolute inset-0 bg-[#06150f]" />
        <div className="absolute inset-0 noise-overlay" />
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />

        <div className="relative z-10 max-w-3xl mx-auto px-6 lg:px-12 text-center">
          <div className="scroll-reveal space-y-8">
            <p className="text-emerald-300 text-[11px] font-bold uppercase tracking-[0.3em]">Get Started Today</p>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-[-0.02em] leading-tight">
              Ready to experience<br />healthcare, reimagined?
            </h2>

            <p className="text-white/40 text-base lg:text-lg max-w-md mx-auto leading-relaxed">
              Join thousands of patients and physicians already transforming how care is delivered across Africa.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link
                href="/signup"
                className="btn-sheen touch-press group inline-flex items-center gap-3 px-10 py-4.5 bg-accent hover:bg-[#0b7a54] text-white text-[15px] font-bold rounded-lg transition-all shadow-[0_0_60px_rgba(15,138,95,0.3)] hover:shadow-[0_0_80px_rgba(15,138,95,0.5)]"
              >
                <span>Create Free Account</span>
                <span className="material-symbols-outlined text-[20px] group-hover:translate-x-1 transition-transform">east</span>
              </Link>
              <Link
                href="/doctor-apply"
                className="touch-press inline-flex items-center gap-2.5 px-8 py-4 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] text-white text-[15px] font-semibold rounded-lg transition-all"
              >
                Apply as a Physician
              </Link>
            </div>

            <p className="text-[11px] text-white/20 font-medium pt-4">
              No credit card required &middot; Free for patients &middot; Setup in under 60 seconds
            </p>
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*  CORPORATE FOOTER                                            */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <footer suppressHydrationWarning className="bg-[#030a07] text-white/50 relative overflow-hidden">
        <div className="absolute inset-0 noise-overlay" />

        {/* Main Footer */}
        <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12 pt-20 pb-12">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-x-8 gap-y-12 mb-16">
            {/* Brand Column */}
            <div className="col-span-2 space-y-5 pr-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center font-black text-base shadow-lg shadow-accent/20">
                  M
                </div>
                <div className="leading-none">
                  <span className="text-xl font-extrabold tracking-tight text-white block">MEDIQ</span>
                  <span className="text-[9px] uppercase tracking-[0.25em] text-emerald-400 font-bold block mt-0.5">Health Systems</span>
                </div>
              </div>
              <p className="text-xs text-white/30 leading-relaxed max-w-[260px]">
                Africa&apos;s leading async-first telehealth platform. Connecting patients with verified, credentialed physicians for continuous, compassionate care.
              </p>
              <div suppressHydrationWarning className="flex flex-wrap items-center gap-x-10 gap-y-4 text-[12px] text-white/25 font-medium">
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-emerald-500/30">location_on</span>
                  Victoria Island, Lagos, Nigeria
                </span>
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-emerald-500/30">call</span>
                  +234 (0) 800-MEDIQ-01
                </span>
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-emerald-500/30">mail</span>
                  care@mediq.health
                </span>
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-emerald-500/30">schedule</span>
                  Support: 24/7
                </span>
              </div>
            </div>

            {/* Link Columns */}
            {[
              { title: 'For Patients', links: [
                { label: 'Create Account', href: '/signup' },
                { label: 'Patient Login', href: '/login' },
                { label: 'Submit a Case', href: '/submit-case' },
                { label: 'My Care Plan', href: '/care-plan' },
                { label: 'Find a Doctor', href: '#' },
              ]},
              { title: 'For Physicians', links: [
                { label: 'Apply Now', href: '/doctor-apply' },
                { label: 'Physician Login', href: '/login' },
                { label: 'Clinical Dashboard', href: '/doctor/dashboard' },
                { label: 'Resources', href: '#' },
              ]},
              { title: 'Company', links: [
                { label: 'About MEDIQ', href: '#' },
                { label: 'Our Mission', href: '#' },
                { label: 'Leadership', href: '#' },
                { label: 'Careers', href: '#' },
                { label: 'Press', href: '#' },
              ]},
              { title: 'Legal', links: [
                { label: 'Privacy Policy', href: '#' },
                { label: 'Terms of Service', href: '#' },
                { label: 'NDPR Compliance', href: '#' },
                { label: 'Cookie Policy', href: '#' },
                { label: 'Accessibility', href: '#' },
              ]},
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em] mb-5">{col.title}</h4>
                <div className="space-y-3">
                  {col.links.map((l) => (
                    <Link key={l.label} href={l.href} className="block text-[13px] text-white/35 hover:text-emerald-400 transition-colors">
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>


          {/* Bottom Bar */}
          <div className="border-t border-white/[0.04] pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p suppressHydrationWarning className="text-[11px] text-white/15">
              © {new Date().getFullYear()} MEDIQ Health Systems Ltd. All rights reserved. RC 1234567.
            </p>
            <div className="flex items-center gap-5">
              {['LinkedIn', 'X', 'Instagram', 'Facebook'].map((s) => (
                <a key={s} href="#" className="text-[11px] text-white/20 hover:text-emerald-400 transition-colors font-semibold uppercase tracking-wider">
                  {s}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
