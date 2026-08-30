'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function SignupPage() {
  const [role, setRole] = useState<'patient' | 'doctor'>('patient')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        full_name: fullName,
        role,
        phone,
      })

      if (profileError) {
        setError(profileError.message)
        return
      }
    }

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="hidden md:block w-1/2 h-screen relative bg-surface-secondary">
        <img
          className="absolute inset-0 w-full h-full object-cover"
          alt="Healthcare professionals"
          src="/a_diverse_group_of_professional_doctors_in_a_modern_high_tech_clinical_setting..png"
        />
      </div>

      <div className="w-full md:w-1/2 flex flex-col justify-center items-center px-6 py-12 bg-white">
        <div className="w-full max-w-md">
          <div className="hidden md:flex items-center gap-2 mb-12 text-accent">
            <span className="material-symbols-outlined text-3xl">medical_services</span>
            <span className="text-2xl font-bold tracking-tight text-primary">MEDIQ</span>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-primary mb-2">Create your account</h1>
            <p className="text-text-muted">Get started with async care, on your schedule</p>
          </div>

          <div className="flex w-full bg-surface-secondary p-1 rounded-lg border border-border-subtle mb-8">
            <button
              type="button"
              onClick={() => setRole('patient')}
              className={`flex-1 py-2 text-center text-sm font-medium rounded-md transition-colors ${
                role === 'patient' ? 'bg-primary text-white' : 'bg-transparent text-text-muted'
              }`}
            >
              Patient
            </button>
            <button
              type="button"
              onClick={() => setRole('doctor')}
              className={`flex-1 py-2 text-center text-sm font-medium rounded-md transition-colors ${
                role === 'doctor' ? 'bg-primary text-white' : 'bg-transparent text-text-muted'
              }`}
            >
              Doctor
            </button>
          </div>

          <form onSubmit={handleSignup} className="space-y-6">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-primary" htmlFor="fullName">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full px-4 py-3 border border-border-subtle rounded-lg text-sm focus:outline-none focus:border-2 focus:border-primary transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-semibold text-primary" htmlFor="email">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className="w-full px-4 py-3 border border-border-subtle rounded-lg text-sm focus:outline-none focus:border-2 focus:border-primary transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-semibold text-primary" htmlFor="phone">
                Phone Number
              </label>
              <input
                id="phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                className="w-full px-4 py-3 border border-border-subtle rounded-lg text-sm focus:outline-none focus:border-2 focus:border-primary transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-semibold text-primary" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-border-subtle rounded-lg text-sm focus:outline-none focus:border-2 focus:border-primary transition-all"
              />
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              type="submit"
              className="w-full py-4 mt-2 bg-accent text-white font-semibold rounded-lg hover:opacity-90 transition-colors"
            >
              Create Account
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-text-muted">
            Already have an account?{' '}
            <Link href="/login" className="text-primary font-semibold border-b border-primary">
              Log in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}