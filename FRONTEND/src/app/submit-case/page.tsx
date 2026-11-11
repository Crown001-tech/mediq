'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import BottomNav from '@/components/dashboard/BottomNav'
import DesktopHeader from '@/components/dashboard/DesktopHeader'
import { formatDoctorName } from '@/shared/utils'
import { sendNotification } from '@/lib/notifications'

type Urgency = 'routine' | 'somewhat_urgent' | 'needs_live_call'

const SLA_HOURS: Record<Urgency, number> = {
  routine: 24,
  somewhat_urgent: 4,
  needs_live_call: 2,
}

const COMMON_CATEGORIES = [
  'Fever & Chills',
  'Pain or Headache',
  'Medication Side Effect',
  'Cough & Breathing',
  'Stomach & Digestion',
  'Skin Rash / Irritation',
  'General Health Question',
]

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.src = e.target?.result as string
    }

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const maxDimension = 1200
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
        0.75
      )
    }

    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function SubmitCasePage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [assignedDoctorId, setAssignedDoctorId] = useState<string | null>(null)
  const [doctorName, setDoctorName] = useState<string | null>(null)
  const [doctorSpecialty, setDoctorSpecialty] = useState<string | null>(null)

  // Form State
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [symptoms, setSymptoms] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('routine')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submittedCaseId, setSubmittedCaseId] = useState<string | null>(null)
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

      // Check if patient has an active care plan or enrollment with an assigned doctor
      const { data: carePlan } = await supabase
        .from('care_plans')
        .select('doctor_id')
        .eq('patient_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let docId = carePlan?.doctor_id || null

      if (!docId) {
        const { data: enrollment } = await supabase
          .from('enrollments')
          .select('doctor_id')
          .eq('patient_id', user.id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()
        if (enrollment?.doctor_id) docId = enrollment.doctor_id
      }

      if (!docId && typeof window !== 'undefined') {
        const localDocId = localStorage.getItem('mediq_assigned_doctor_id')
        if (localDocId) docId = localDocId
      }

      if (docId) {
        setAssignedDoctorId(docId)
        const { data: docProfile } = await supabase
          .from('profiles')
          .select('full_name, specialty')
          .eq('id', docId)
          .maybeSingle()

        if (docProfile) {
          setDoctorName(formatDoctorName(docProfile.full_name, 'Your Doctor'))
          setDoctorSpecialty(docProfile.specialty || 'General Practice')
        } else if (typeof window !== 'undefined') {
          const cachedDocName = localStorage.getItem('mediq_assigned_doctor_name')
          if (cachedDocName) setDoctorName(formatDoctorName(cachedDocName, 'Your Doctor'))
        }
      }
    }

    loadUser()
  }, [router])

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 8 * 1024 * 1024) {
      setError('Photo must be under 8MB')
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

  const handleCategorySelect = (category: string) => {
    if (selectedCategory === category) {
      setSelectedCategory(null)
    } else {
      setSelectedCategory(category)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!symptoms.trim()) {
      setError('Please describe what symptoms or concerns you are having.')
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
          // Continue even if storage bucket isn't configured, but note error
          console.warn('Photo upload warning:', uploadError.message)
        } else {
          const { data: urlData } = supabase.storage
            .from('case-photos')
            .getPublicUrl(fileName)
          photoUrl = urlData.publicUrl
        }
      } catch (err) {
        console.warn('Photo compression warning:', err)
      }
    }

    const targetResponseBy = new Date()
    targetResponseBy.setHours(targetResponseBy.getHours() + SLA_HOURS[urgency])

    const fullDescription = selectedCategory
      ? `[${selectedCategory}] ${symptoms.trim()}`
      : symptoms.trim()

    const { data: caseRow, error: insertError } = await supabase
      .from('cases')
      .insert({
        patient_id: user.id,
        doctor_id: assignedDoctorId,
        symptoms_description: fullDescription,
        photo_url: photoUrl,
        urgency,
        status: 'pending',
        target_response_by: targetResponseBy.toISOString(),
      })
      .select('id')
      .single()

    setSubmitting(false)

    if (insertError || !caseRow) {
      setError(insertError?.message || 'Failed to submit case. Please try again.')
      return
    }

    // Send in-app notification to assigned doctor
    if (assignedDoctorId) {
      try {
        const patientDisplayName = fullName || 'A patient'
        await sendNotification({
          userId: assignedDoctorId,
          title: 'New Patient Case Submitted',
          message: `${patientDisplayName} submitted a new follow-up note: "${fullDescription.slice(0, 70)}..."`,
          type: 'new_case',
        })
      } catch (notifErr) {
        console.warn('Doctor notification warning:', notifErr)
      }
    }

    setSubmittedCaseId(caseRow.id)
  }

  const urgencyOptions: { value: Urgency; icon: string; label: string; sub: string }[] = [
    {
      value: 'routine',
      icon: 'schedule',
      label: 'Standard Review',
      sub: 'Not urgent • Doctor response within 24 hours',
    },
    {
      value: 'somewhat_urgent',
      icon: 'priority_high',
      label: 'Needs Attention',
      sub: 'Uncomfortable symptom • Doctor review within 4 hours',
    },
    {
      value: 'needs_live_call',
      icon: 'notification_important',
      label: 'Urgent Concern',
      sub: 'Priority attention • Requests fastest available physician review',
    },
  ]

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <Sidebar fullName={fullName} email={email} activePage="My Cases" />
      <DesktopHeader />
      <TopBar />

      <main className="md:ml-64 flex flex-col pb-28 md:pb-12 pt-16 md:pt-0">
        <div className="max-w-[760px] mx-auto w-full px-4 sm:px-6 py-6 md:py-10">
          {/* ── Breadcrumb Navigation ─────────────────────── */}
          <Link
            href="/cases"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline mb-4 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to My Cases
          </Link>

          {/* ── Confirmation / Success Screen ─────────────── */}
          {submittedCaseId ? (
            <div className="bg-white border border-emerald-200 rounded-2xl p-8 md:p-12 text-center space-y-5 shadow-xs animate-in fade-in duration-200">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-xs">
                <span className="material-symbols-outlined text-[36px]">task_alt</span>
              </div>

              <div className="max-w-md mx-auto space-y-2">
                <h2 className="text-2xl font-bold text-primary">Case Submitted!</h2>
                <p className="text-sm text-text-muted leading-relaxed">
                  {doctorName ? (
                    <>
                      Your report has been sent directly to <strong className="text-primary">{doctorName}</strong>. You will receive an in-app notification as soon as your doctor reviews it.
                    </>
                  ) : (
                    <>
                      Your report has been submitted to the physician review queue. You will receive an in-app notification as soon as a doctor responds.
                    </>
                  )}
                </p>
              </div>

              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href={`/cases/${submittedCaseId}`}
                  className="w-full sm:w-auto px-6 py-2.5 bg-accent hover:bg-[#0c704d] text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  <span>View Case Details</span>
                </Link>

                <Link
                  href="/dashboard"
                  className="w-full sm:w-auto px-6 py-2.5 bg-white border border-border-subtle hover:bg-surface-secondary text-primary font-semibold text-xs rounded-xl transition-all shadow-2xs"
                >
                  Return to Dashboard
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* ── Main Submission Form ─────────────────────── */}
              {/* Header */}
              <div className="border-b border-border-subtle pb-5">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-bold">
                    <span className="material-symbols-outlined text-[22px]">medical_services</span>
                  </div>
                  <h1 className="text-2xl md:text-3xl font-bold text-primary">
                    Submit a Health Case
                  </h1>
                </div>
                <p className="text-xs md:text-sm text-text-muted mt-1 leading-relaxed">
                  Experiencing a symptom, medication side effect, or health question? Describe it here for your doctor to review.
                </p>

                {/* Assigned Doctor Badge */}
                {doctorName && (
                  <div className="mt-3.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-secondary border border-border-subtle text-xs text-primary">
                    <span className="material-symbols-outlined text-accent text-[16px]">stethoscope</span>
                    <span>
                      Your Doctor: <strong className="text-primary">{doctorName}</strong>
                      {doctorSpecialty && ` (${doctorSpecialty})`}
                    </span>
                  </div>
                )}
              </div>

              {/* Safety notice */}
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 shadow-xs">
                <span className="material-symbols-outlined text-red-600 text-[20px] shrink-0 mt-0.5">
                  warning
                </span>
                <p className="text-xs text-red-900 leading-relaxed">
                  <strong>Not for immediate medical emergencies.</strong> If you are experiencing severe chest pain, shortness of breath, or any life-threatening condition, call emergency services or go to the nearest emergency department right away.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* ── 1. Category Chips ──────────────────────── */}
                <div className="bg-white border border-border-subtle rounded-2xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
                      1. What type of issue are you experiencing?
                    </label>
                    <span className="text-[11px] text-text-muted">Select one</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {COMMON_CATEGORIES.map((cat) => {
                      const isSelected = selectedCategory === cat
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => handleCategorySelect(cat)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${isSelected
                              ? 'bg-accent text-white border-accent shadow-xs'
                              : 'bg-surface-secondary/60 text-primary border-border-subtle hover:bg-surface-secondary'
                            }`}
                        >
                          {cat}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ── 2. Symptom Description ─────────────────── */}
                <div className="bg-white border border-border-subtle rounded-2xl p-5 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="symptoms"
                      className="text-xs font-bold uppercase tracking-wider text-text-muted"
                    >
                      2. Describe what you are feeling
                    </label>
                    <span className="text-[11px] text-accent font-medium">Required</span>
                  </div>

                  <p className="text-xs text-text-muted">
                    Helpful details to include: When did it start? How bad does it feel? Have you taken any medicines?
                  </p>

                  <textarea
                    id="symptoms"
                    rows={6}
                    value={symptoms}
                    onChange={(e) => setSymptoms(e.target.value)}
                    placeholder="Tell your doctor what is happening in your own words..."
                    className="w-full bg-surface-secondary/30 border border-border-subtle rounded-xl p-4 text-sm text-primary placeholder:text-text-muted focus:border-accent focus:bg-white focus:ring-0 transition-all resize-none leading-relaxed"
                  />
                </div>

                {/* ── 3. Add a Photo (Optional) ──────────────── */}
                <div className="bg-white border border-border-subtle rounded-2xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
                      3. Attach a Photo (Optional)
                    </label>
                    <span className="text-[11px] text-text-muted">For rashes, swelling, or visible symptoms</span>
                  </div>

                  {!photoPreview ? (
                    <label className="border-2 border-dashed border-border-subtle rounded-xl bg-surface-secondary/30 hover:bg-surface-secondary/60 transition-colors p-6 flex flex-col items-center justify-center text-center cursor-pointer">
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={handlePhotoSelect}
                        className="hidden"
                      />
                      <span className="material-symbols-outlined text-accent text-3xl mb-2">
                        add_photo_alternate
                      </span>
                      <p className="text-xs font-bold text-primary mb-0.5">
                        Click to upload a photo
                      </p>
                      <p className="text-[11px] text-text-muted">JPG or PNG up to 8MB</p>
                    </label>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-border-subtle h-48 bg-surface-secondary flex items-center justify-center">
                      <img
                        src={photoPreview}
                        alt="Symptom preview"
                        className="w-full h-full object-contain"
                      />
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="absolute top-3 right-3 bg-black/70 hover:bg-black text-white rounded-full p-1.5 transition-colors cursor-pointer shadow-sm"
                        title="Remove photo"
                      >
                        <span className="material-symbols-outlined text-[16px] block">close</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* ── 4. Urgency Level ───────────────────────── */}
                <div className="bg-white border border-border-subtle rounded-2xl p-5 shadow-xs space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-text-muted block">
                    4. How urgently do you need a response?
                  </label>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {urgencyOptions.map((opt) => {
                      const isSelected = urgency === opt.value
                      return (
                        <label
                          key={opt.value}
                          className={`relative flex flex-col rounded-xl p-4 cursor-pointer transition-all border-2 ${isSelected
                              ? 'border-accent bg-accent/5 shadow-2xs'
                              : 'border-border-subtle bg-white hover:border-accent/40'
                            }`}
                        >
                          <input
                            type="radio"
                            name="urgency"
                            value={opt.value}
                            checked={isSelected}
                            onChange={() => setUrgency(opt.value)}
                            className="sr-only"
                          />
                          <div className="flex items-center gap-2 mb-2">
                            <span
                              className={`material-symbols-outlined text-[20px] ${isSelected ? 'text-accent' : 'text-text-muted'
                                }`}
                            >
                              {opt.icon}
                            </span>
                            <span className="text-xs font-bold text-primary">
                              {opt.label}
                            </span>
                          </div>
                          <span className="text-[11px] text-text-muted leading-relaxed">
                            {opt.sub}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {/* Error Banner */}
                {error && (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">error</span>
                    <span>{error}</span>
                  </div>
                )}

                {/* Submit Button */}
                <div className="pt-2 flex items-center justify-end gap-3">
                  <Link
                    href="/cases"
                    className="px-5 py-2.5 text-xs font-semibold text-text-muted hover:text-primary transition-colors"
                  >
                    Cancel
                  </Link>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-8 py-3 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Submitting Case...</span>
                      </>
                    ) : (
                      <>
                        <span>Submit Case to Doctor</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  )
}