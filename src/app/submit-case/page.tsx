'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/DesktopHeader'

type Urgency = 'routine' | 'somewhat_urgent' | 'needs_live_call'

const SLA_HOURS: Record<Urgency, number> = {
  routine: 24,
  somewhat_urgent: 4,
  needs_live_call: 0,
}

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.src = e.target?.result as string
    }

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const maxDimension = 1000
      let { width, height } = img

      if (width > height && width > maxDimension) {
        height = (height * maxDimension) / width
        width = maxDimension
      } else if (height > maxDimension) {
        width = (width * maxDimension) / height
        height = maxDimension
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Compression failed'))
        },
        'image/jpeg',
        0.7
      )
    }

    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function SubmitCasePage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('routine')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    const loadUser = async () => {
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

      if (profile) setFullName(profile.full_name)
    }

    loadUser()
  }, [router])

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      setError('Photo must be under 5MB')
      return
    }

    setError('')
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const removePhoto = () => {
    setPhotoFile(null)
    setPhotoPreview(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!symptoms.trim()) {
      setError('Please describe your symptoms')
      return
    }

    setSubmitting(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    let photoUrl: string | null = null

    if (photoFile) {
      try {
        const compressedBlob = await compressImage(photoFile)
        const fileName = `${user.id}/${Date.now()}.jpg`

        const { error: uploadError } = await supabase.storage
          .from('case-photos')
          .upload(fileName, compressedBlob, { contentType: 'image/jpeg' })

        if (uploadError) {
          setError('Photo upload failed: ' + uploadError.message)
          setSubmitting(false)
          return
        }

        const { data: urlData } = supabase.storage
          .from('case-photos')
          .getPublicUrl(fileName)

        photoUrl = urlData.publicUrl
      } catch {
        setError('Could not process photo')
        setSubmitting(false)
        return
      }
    }

    const targetResponseBy = new Date()
    targetResponseBy.setHours(targetResponseBy.getHours() + SLA_HOURS[urgency])

    const { error: insertError } = await supabase.from('cases').insert({
      patient_id: user.id,
      doctor_id: null,
      symptoms_description: symptoms,
      photo_url: photoUrl,
      urgency,
      status: 'pending',
      target_response_by: targetResponseBy.toISOString(),
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    router.push('/dashboard')
  }

  const urgencyOptions: { value: Urgency; icon: string; label: string; sub: string }[] = [
    { value: 'routine', icon: 'event_note', label: 'Routine', sub: 'Response within 24 hours' },
    { value: 'somewhat_urgent', icon: 'schedule', label: 'Somewhat Urgent', sub: 'Response within 4 hours' },
    { value: 'needs_live_call', icon: 'video_call', label: 'Needs Live Call', sub: 'Immediate — connects you to a live consultation instead' },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Sidebar fullName={fullName} email={email} activePage="Dashboard" />
      <DesktopHeader/>
      <TopBar />

      <main className="md:ml-64 flex flex-col pb-24 md:pb-8">
        <div className="max-w-[720px] mx-auto w-full px-4 md:px-8 py-6 md:py-12">
          <div className="mb-8 md:mb-10">
            <h2 className="text-2xl md:text-3xl font-semibold text-primary mb-2">Submit a Case</h2>
            <p className="text-sm md:text-base text-text-muted">
              Describe what you're experiencing — a doctor will respond within your expected timeframe.
            </p>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8 flex items-start gap-3">
            <span className="material-symbols-outlined text-red-600 mt-0.5 text-[20px]">warning</span>
            <p className="text-sm text-primary">
              <strong className="font-semibold text-red-600">This is not for emergencies.</strong>{' '}
              If you're experiencing a medical emergency, call emergency services or go to the nearest hospital immediately.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8 md:space-y-10">
            <div className="space-y-2">
              <label htmlFor="symptoms" className="block text-xs font-semibold text-primary uppercase tracking-wider">
                What's going on?
              </label>
              <textarea
                id="symptoms"
                rows={7}
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="Describe your symptoms in your own words..."
                className="w-full bg-white border border-border-subtle rounded-lg p-4 text-sm text-primary placeholder:text-text-muted focus:border-primary focus:ring-0 focus:border-2 transition-all resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-primary uppercase tracking-wider">
                Add a photo (optional)
              </label>

              {!photoPreview ? (
                <label className="border-2 border-dashed border-border-subtle rounded-lg bg-white hover:bg-surface-secondary transition-colors p-8 flex flex-col items-center justify-center text-center cursor-pointer">
                  <input type="file" accept="image/jpeg,image/png" onChange={handlePhotoSelect} className="hidden" />
                  <span className="material-symbols-outlined text-text-muted text-4xl mb-3">cloud_upload</span>
                  <p className="text-sm font-medium text-primary mb-1">Click to upload or drag and drop</p>
                  <p className="text-xs text-text-muted">JPG or PNG, max 5MB</p>
                </label>
              ) : (
                <div className="relative rounded-lg overflow-hidden border border-border-subtle h-40">
                  <img src={photoPreview} alt="Symptom preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="absolute top-2 right-2 bg-black/70 text-white rounded-full p-1 hover:bg-black transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <label className="block text-xs font-semibold text-primary uppercase tracking-wider">
                How urgent is this?
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {urgencyOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className={`relative flex flex-col rounded-lg p-5 cursor-pointer transition-colors border-2 ${
                      urgency === opt.value
                        ? 'border-accent bg-accent/5'
                        : 'border-border-subtle bg-white hover:border-primary/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="urgency"
                      value={opt.value}
                      checked={urgency === opt.value}
                      onChange={() => setUrgency(opt.value)}
                      className="sr-only"
                    />
                    <span className={`material-symbols-outlined mb-3 ${urgency === opt.value ? 'text-accent' : 'text-text-muted'}`}>
                      {opt.icon}
                    </span>
                    <span className="text-base font-semibold text-primary mb-1">{opt.label}</span>
                    <span className="text-sm text-text-muted">{opt.sub}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="pt-6 border-t border-border-subtle flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="w-full md:w-auto bg-accent hover:opacity-90 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <span>{submitting ? 'Submitting...' : 'Submit Case'}</span>
                {!submitting && <span className="material-symbols-outlined text-sm">arrow_forward</span>}
              </button>
            </div>
          </form>
        </div>
      </main>

      <BottomNav />
    </div>
  )
}