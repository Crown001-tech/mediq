'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function RedirectLegacyDoctorCasePage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  useEffect(() => {
    if (id) {
      router.replace(`/doctor/case/${id}`)
    } else {
      router.replace('/doctor/dashboard')
    }
  }, [id, router])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
