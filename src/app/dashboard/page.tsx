'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import BottomNav from '@/components/dashboard/BottomNav'
import TopBar from '@/components/dashboard/TopBar'
import UrgentZone from '@/components/dashboard/UrgentZone'
import QuickActions from '@/components/dashboard/QuickAction'
import CasesList from '@/components/dashboard/CasesList'
import CarePlanCard from '@/components/dashboard/CarePlanCard'
import DesktopHeader from '@/components/DesktopHeader'

type CaseItem = {
  id: string
  symptoms_description: string
  urgency: string
  status: string
  created_at: string
}

type CarePlan = {
  type: string
  details: string
  schedule: string
}

export default function DashboardPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [cases, setCases] = useState<CaseItem[]>([])
  const [carePlan, setCarePlan] = useState<CarePlan | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const loadDashboard = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setEmail(user.email || '')

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()

      if (profile) {
        setFullName(profile.full_name || '')
      }

      const { data: casesData } = await supabase
        .from('cases')
        .select('id, symptoms_description, urgency, status, created_at')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false })

      if (casesData) {
        setCases(casesData)
      }

      const { data: carePlanData } = await supabase
        .from('care_plans')
        .select('type, details, schedule')
        .eq('patient_id', user.id)
        .eq('active', true)
        .limit(1)
        .maybeSingle()

      if (carePlanData) {
        setCarePlan(carePlanData)
      }

      setLoading(false)
    }

    loadDashboard()
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-text-muted">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar fullName={fullName} email={email} />
      <DesktopHeader/>
      <TopBar />

      <main className="md:ml-64 flex flex-col pb-24 md:pb-8">
        <div className="max-w-[960px] mx-auto w-full px-4 md:px-8 py-6 md:py-8 flex flex-col gap-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-semibold text-primary">
              Welcome back{fullName ? `, ${fullName}` : ''}
            </h2>
            <p className="text-sm text-text-muted mt-1">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>

          <UrgentZone hospitalAlert={null} doseReminder={null} />

          <QuickActions />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
              <CasesList cases={cases} />
            </div>
            <div className="lg:col-span-2">
              {carePlan ? (
                <CarePlanCard
                  type={carePlan.type}
                  details={carePlan.details}
                  schedule={carePlan.schedule}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <h3 className="text-lg font-semibold text-primary border-b border-border-subtle pb-2">
                    Care Plan
                  </h3>
                  <p className="text-sm text-text-muted">
                    You don't have an active care plan yet.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  )
}
