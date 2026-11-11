'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DoctorSidebar from '@/components/dashboard/DoctorSideBar'
import DoctorDesktopHeader from '@/components/DoctorDesktopHeader'
import PrintableCarePlan, { PrintableMedication } from '@/components/care-plan/PrintableCarePlan'
import { sendNotification } from '@/lib/notifications'
import { formatDoctorName } from '@/shared/utils'

type PlanType = 'medication' | 'checkin'
type Cadence = 'daily' | 'every_3_days' | 'weekly' | 'monthly'

export type MedicationRow = {
  id: string
  name: string
  form: string
  doseAmount: string
  doseUnit: string
  strength: string
  frequency: string
  scheduleTimes: string[]
  routeTiming: string
  duration: string
  instructions: string
}

const COMMON_DRUGS = [
  'Amlodipine',
  'Amoxicillin',
  'Amoxicillin/Clavulanate',
  'Atorvastatin',
  'Azithromycin',
  'Ceftriaxone',
  'Ciprofloxacin',
  'Coartem (Artemether/Lumefantrine)',
  'Cough Syrup (Expectorant)',
  'Hydrochlorothiazide',
  'Ibuprofen',
  'Lisinopril',
  'Losartan',
  'Metformin',
  'Omeprazole',
  'Paracetamol (Acetaminophen)',
  'Prednisolone',
  'Salbutamol Inhaler',
]

export const FORM_OPTIONS = [
  'Tablet',
  'Capsule',
  'Syrup / Oral Liquid',
  'Injection',
  'Inhaler',
  'Topical Cream',
  'Drops',
  'Suppository',
]

export const FORM_DEFAULTS: Record<string, { units: string[]; defaultUnit: string; defaultRoute: string; placeholderAmount: string; exampleStrength: string }> = {
  'Tablet': {
    units: ['tablet(s)', 'half-tablet(s)', 'caplet(s)'],
    defaultUnit: 'tablet(s)',
    defaultRoute: 'Oral • After meals',
    placeholderAmount: '2',
    exampleStrength: '500 mg',
  },
  'Capsule': {
    units: ['capsule(s)'],
    defaultUnit: 'capsule(s)',
    defaultRoute: 'Oral • With water',
    placeholderAmount: '1',
    exampleStrength: '250 mg',
  },
  'Syrup / Oral Liquid': {
    units: ['ml', 'teaspoon(s) (5ml)', 'tablespoon(s) (15ml)'],
    defaultUnit: 'ml',
    defaultRoute: 'Oral • After meals',
    placeholderAmount: '10',
    exampleStrength: '125 mg/5ml',
  },
  'Injection': {
    units: ['vial (clinic visit)', 'ampoule', 'IM dose', 'IU (Insulin)'],
    defaultUnit: 'vial (clinic visit)',
    defaultRoute: 'Hospital / Clinic Visit (IM/IV)',
    placeholderAmount: '1',
    exampleStrength: '1 g',
  },
  'Inhaler': {
    units: ['puff(s)', 'inhalation(s)'],
    defaultUnit: 'puff(s)',
    defaultRoute: 'Inhalation as directed',
    placeholderAmount: '2',
    exampleStrength: '100 mcg',
  },
  'Drops': {
    units: ['drop(s) in eye', 'drop(s) in ear', 'drop(s) in nose'],
    defaultUnit: 'drop(s) in eye',
    defaultRoute: 'Instill into affected eye/ear',
    placeholderAmount: '2',
    exampleStrength: '0.5%',
  },
  'Topical Cream': {
    units: ['application', 'thin layer', 'fingertip unit (FTU)'],
    defaultUnit: 'application',
    defaultRoute: 'Topical application to affected area',
    placeholderAmount: '1',
    exampleStrength: '1% w/w',
  },
  'Suppository': {
    units: ['suppository', 'insert'],
    defaultUnit: 'suppository',
    defaultRoute: 'Rectal insertion',
    placeholderAmount: '1',
    exampleStrength: '100 mg',
  },
}

const FREQUENCY_MAP: Record<string, { label: string; times: string[] }> = {
  'once_daily': {
    label: 'Once Daily (QD)',
    times: ['08:00 AM'],
  },
  'twice_daily': {
    label: 'Twice Daily (BID)',
    times: ['08:00 AM', '08:00 PM'],
  },
  'tid': {
    label: 'Three Times Daily (TID)',
    times: ['08:00 AM', '02:00 PM', '08:00 PM'],
  },
  'qid': {
    label: 'Four Times Daily (QID)',
    times: ['08:00 AM', '12:00 PM', '04:00 PM', '08:00 PM'],
  },
  'every_12_hours': {
    label: 'Every 12 Hours',
    times: ['08:00 AM', '08:00 PM'],
  },
  'every_8_hours': {
    label: 'Every 8 Hours',
    times: ['08:00 AM', '04:00 PM', '12:00 AM'],
  },
  'bedtime': {
    label: 'At Bedtime (QHS)',
    times: ['10:00 PM'],
  },
  'prn': {
    label: 'As Needed (PRN)',
    times: ['As Needed (PRN)'],
  },
}

const ROUTE_TIMING_OPTIONS = [
  'Oral • After meals',
  'Oral • With meals',
  'Oral • Before meals',
  'Oral • Empty stomach',
  'Oral • Bedtime',
  'Hospital / Clinic Visit (IM/IV)',
  'Topical application',
  'Inhalation as directed',
  'Instill into affected eye/ear',
  'Sublingual',
]

const DURATION_OPTIONS = [
  '3 Days',
  '5 Days',
  '7 Days',
  '10 Days',
  '14 Days',
  '30 Days',
  '60 Days',
  '90 Days',
  'Ongoing / Chronic',
]

export function buildMedicationInstruction(med: {
  form: string
  doseAmount: string
  doseUnit: string
  strength: string
  frequency: string
  routeTiming: string
}): string {
  const form = med.form || 'Tablet'
  const amount = med.doseAmount || '1'
  const unit = med.doseUnit || 'tablet(s)'
  const freqLabel = FREQUENCY_MAP[med.frequency]?.label.toLowerCase() || med.frequency.replace('_', ' ')
  const timing = med.routeTiming || 'Oral • After meals'
  const strengthPart = med.strength && med.strength.trim() ? ` (${med.strength.trim()})` : ''

  if (form === 'Injection') {
    return `Report to hospital/clinic for ${amount} ${unit}${strengthPart} injection, ${freqLabel} (${timing}).`
  }
  if (form === 'Syrup / Oral Liquid') {
    return `Take ${amount} ${unit}${strengthPart}, ${freqLabel} (${timing}).`
  }
  if (form === 'Inhaler') {
    return `Inhale ${amount} ${unit}${strengthPart}, ${freqLabel} (${timing}).`
  }
  if (form === 'Drops') {
    return `Instill ${amount} ${unit}${strengthPart}, ${freqLabel} (${timing}).`
  }
  if (form === 'Topical Cream') {
    return `Apply ${amount} ${unit}${strengthPart} to affected area, ${freqLabel} (${timing}).`
  }
  if (form === 'Suppository') {
    return `Insert ${amount} ${unit}${strengthPart}, ${freqLabel} (${timing}).`
  }
  return `Take ${amount} ${unit}${strengthPart}, ${freqLabel} (${timing}).`
}

function createDefaultMedRow(): MedicationRow {
  return {
    id: Math.random().toString(36).substring(2, 9),
    name: 'Paracetamol',
    form: 'Tablet',
    doseAmount: '2',
    doseUnit: 'tablet(s)',
    strength: '500 mg',
    frequency: 'twice_daily',
    scheduleTimes: ['08:00 AM', '08:00 PM'],
    routeTiming: 'Oral • After meals',
    duration: '5 Days',
    instructions: 'Take 2 tablet(s) (500 mg) twice daily (oral • after meals).',
  }
}

export default function CreateCarePlanPage() {
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [planType, setPlanType] = useState<PlanType>('medication')
  const [medications, setMedications] = useState<MedicationRow[]>([createDefaultMedRow()])
  const [cadence, setCadence] = useState<Cadence>('every_3_days')
  const [indicationNotes, setIndicationNotes] = useState('')
  const [activeTab, setActiveTab] = useState<'matrix' | 'preview'>('matrix')
  const [existingPlanId, setExistingPlanId] = useState<string | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const router = useRouter()
  const params = useParams()
  const patientId = params.id as string

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setDoctorId(user.id)

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, specialty')
        .eq('id', user.id)
        .single()
      if (profile) {
        setFullName(profile.full_name)
        setSpecialty(profile.specialty || '')
      }

      const { data: patientProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', patientId)
        .single()
      if (patientProfile?.full_name) {
        setPatientName(patientProfile.full_name)
      } else {
        setPatientName(`Patient #${patientId.slice(0, 5).toUpperCase()}`)
      }

      // Check for existing active care plan to prefill in Edit Mode
      const { data: existingPlans } = await supabase
        .from('care_plans')
        .select('id, type, details, schedule, created_at')
        .eq('patient_id', patientId)
        .eq('active', true)
        .order('created_at', { ascending: false })

      const activePlan = existingPlans?.[0]
      if (activePlan) {
        setExistingPlanId(activePlan.id)
        setIsEditMode(true)
        if (activePlan.type === 'check_in' || activePlan.type === 'checkin') {
          setPlanType('checkin')
        } else {
          setPlanType('medication')
        }

        // Parse cadence
        const s = (activePlan.schedule || '').toLowerCase().replace(/\s+/g, '_')
        if (s.includes('daily')) setCadence('daily')
        else if (s.includes('3_day') || s.includes('3 days')) setCadence('every_3_days')
        else if (s.includes('week')) setCadence('weekly')
        else if (s.includes('month')) setCadence('monthly')

        // Parse details for indication notes if present
        if (activePlan.details) {
          const parts = activePlan.details.split('—')
          if (parts.length > 1) {
            setIndicationNotes(parts.slice(1).join('—').trim())
          } else if (!activePlan.details.includes('medication(s) prescribed')) {
            setIndicationNotes(activePlan.details)
          }
        }

        // Fetch existing medications for this plan
        const { data: existingMeds } = await supabase
          .from('medications')
          .select('id, name, dosage, schedule_times, instructions')
          .eq('care_plan_id', activePlan.id)
          .order('created_at', { ascending: true })

        if (existingMeds && existingMeds.length > 0) {
          const loadedRows: MedicationRow[] = existingMeds.map((m) => {
            let drugName = m.name || ''
            let form = 'Tablet'
            const formMatch = drugName.match(/\(([^)]+)\)$/)
            if (formMatch) {
              form = formMatch[1]
              drugName = drugName.replace(/\s*\([^)]+\)$/, '').trim()
            }

            let doseAmount = '2'
            let doseUnit = 'tablet(s)'
            let strength = '500 mg'

            if (m.dosage) {
              const bulletParts = m.dosage.split('•').map((s: string) => s.trim())
              if (bulletParts.length >= 2) {
                const intakeTokens = bulletParts[0].split(/\s+/)
                doseAmount = intakeTokens[0] || '1'
                doseUnit = intakeTokens.slice(1).join(' ') || 'dose'
                strength = bulletParts[1] || ''
              } else {
                const parts = m.dosage.trim().split(/\s+/)
                if (parts.length >= 2) {
                  doseAmount = parts[0]
                  doseUnit = parts.slice(1).join(' ')
                } else if (parts.length === 1) {
                  doseAmount = parts[0]
                }
              }
            }

            const times = m.schedule_times
              ? m.schedule_times.split(',').map((t: string) => t.trim())
              : ['08:00 AM']

            let frequency = 'once_daily'
            if (times.length === 2) frequency = 'twice_daily'
            else if (times.length === 3) frequency = 'tid'
            else if (times.length === 4) frequency = 'qid'

            let routeTiming = 'Oral • After meals'
            let duration = '30 Days'
            let instructions = ''

            if (m.instructions) {
              const tokens = m.instructions.split('•').map((t: string) => t.trim())
              tokens.forEach((tok: string) => {
                if (tok.toLowerCase().startsWith('duration:')) {
                  duration = tok.replace(/duration:\s*/i, '').trim()
                } else if (tok.toLowerCase().startsWith('notes:')) {
                  instructions = tok.replace(/notes:\s*/i, '').trim()
                } else if (
                  ROUTE_TIMING_OPTIONS.some((r) => r.toLowerCase() === tok.toLowerCase())
                ) {
                  routeTiming = tok
                } else if (!instructions && !tok.toLowerCase().startsWith('route:')) {
                  instructions = tok
                }
              })
            }

            return {
              id: m.id || Math.random().toString(36).substring(2, 9),
              name: drugName,
              form,
              doseAmount,
              doseUnit,
              strength,
              frequency,
              scheduleTimes: times,
              routeTiming,
              duration,
              instructions: instructions || buildMedicationInstruction({ form, doseAmount, doseUnit, strength, frequency, routeTiming }),
            }
          })
          setMedications(loadedRows)
        }
      }

      setLoading(false)
    }

    if (patientId) loadData()
  }, [patientId, router])

  const cadenceOptions: { value: Cadence; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'every_3_days', label: 'Every 3 Days' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ]

  // Update a row field
  const updateRow = <K extends keyof MedicationRow>(id: string, field: K, value: MedicationRow[K]) => {
    setMedications((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row

        const updated = { ...row, [field]: value }

        if (field === 'frequency') {
          const freqKey = value as string
          const defaultTimes = FREQUENCY_MAP[freqKey]?.times || ['08:00 AM']
          updated.scheduleTimes = defaultTimes
        }

        if (field === 'form') {
          const fConfig = FORM_DEFAULTS[value as string]
          if (fConfig) {
            updated.doseUnit = fConfig.defaultUnit
            updated.doseAmount = fConfig.placeholderAmount
            updated.routeTiming = fConfig.defaultRoute
            if (!updated.strength || updated.strength === '500 mg') {
              updated.strength = fConfig.exampleStrength
            }
          }
        }

        // Auto-refresh instruction when key clinical parameters change, unless manual override is active
        if (field === 'form' || field === 'frequency' || field === 'doseAmount' || field === 'doseUnit' || field === 'routeTiming' || field === 'strength') {
          updated.instructions = buildMedicationInstruction(updated)
        }

        return updated
      })
    )
  }

  const addRow = () => {
    setMedications((prev) => [...prev, createDefaultMedRow()])
  }

  const removeRow = (id: string) => {
    if (medications.length <= 1) return
    setMedications((prev) => prev.filter((r) => r.id !== id))
  }

  // Quick Clinical Presets
  const applyPreset = (presetName: 'hypertension' | 'diabetes' | 'antibiotic' | 'postop') => {
    if (presetName === 'hypertension') {
      setMedications([
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Amlodipine',
          form: 'Tablet',
          doseAmount: '1',
          doseUnit: 'tablet(s)',
          strength: '5 mg',
          frequency: 'once_daily',
          scheduleTimes: ['08:00 AM'],
          routeTiming: 'Oral • After meals',
          duration: 'Ongoing / Chronic',
          instructions: 'Take 1 tablet(s) (5 mg) once daily (oral • after meals). Monitor blood pressure.',
        },
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Lisinopril',
          form: 'Tablet',
          doseAmount: '1',
          doseUnit: 'tablet(s)',
          strength: '10 mg',
          frequency: 'once_daily',
          scheduleTimes: ['08:00 AM'],
          routeTiming: 'Oral • After meals',
          duration: 'Ongoing / Chronic',
          instructions: 'Take 1 tablet(s) (10 mg) once daily (oral • after meals). Report persistent dry cough.',
        },
      ])
      setCadence('every_3_days')
      setIndicationNotes('Essential Hypertension Management Protocol')
    } else if (presetName === 'diabetes') {
      setMedications([
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Metformin',
          form: 'Tablet',
          doseAmount: '1',
          doseUnit: 'tablet(s)',
          strength: '500 mg',
          frequency: 'twice_daily',
          scheduleTimes: ['08:00 AM', '08:00 PM'],
          routeTiming: 'Oral • With meals',
          duration: 'Ongoing / Chronic',
          instructions: 'Take 1 tablet(s) (500 mg) strictly with breakfast & dinner to prevent nausea.',
        },
      ])
      setCadence('weekly')
      setIndicationNotes('Type-2 Diabetes Glycemic Control')
    } else if (presetName === 'antibiotic') {
      setMedications([
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Amoxicillin/Clavulanate',
          form: 'Capsule',
          doseAmount: '1',
          doseUnit: 'capsule(s)',
          strength: '625 mg',
          frequency: 'twice_daily',
          scheduleTimes: ['08:00 AM', '08:00 PM'],
          routeTiming: 'Oral • After meals',
          duration: '7 Days',
          instructions: 'Take 1 capsule(s) (625 mg) twice daily with food. Complete full 7 days.',
        },
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Ceftriaxone',
          form: 'Injection',
          doseAmount: '1',
          doseUnit: 'vial (clinic visit)',
          strength: '1 g',
          frequency: 'once_daily',
          scheduleTimes: ['09:00 AM'],
          routeTiming: 'Hospital / Clinic Visit (IM/IV)',
          duration: '3 Days',
          instructions: 'Report to clinic/hospital for 1 vial (1 g) IM/IV injection once daily at 09:00 AM.',
        },
      ])
      setCadence('daily')
      setIndicationNotes('Acute Infection Treatment Protocol')
    } else if (presetName === 'postop') {
      setMedications([
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Paracetamol',
          form: 'Tablet',
          doseAmount: '2',
          doseUnit: 'tablet(s)',
          strength: '500 mg',
          frequency: 'twice_daily',
          scheduleTimes: ['08:00 AM', '08:00 PM'],
          routeTiming: 'Oral • After meals',
          duration: '5 Days',
          instructions: 'Take 2 tablet(s) (500 mg each) twice daily after meals with water for pain.',
        },
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Cough Syrup (Expectorant)',
          form: 'Syrup / Oral Liquid',
          doseAmount: '10',
          doseUnit: 'ml',
          strength: '125 mg/5ml',
          frequency: 'once_daily',
          scheduleTimes: ['10:00 PM'],
          routeTiming: 'Oral • Bedtime',
          duration: '5 Days',
          instructions: 'Take 10 ml (2 teaspoonfuls) once daily at bedtime.',
        },
      ])
      setCadence('every_3_days')
      setIndicationNotes('Post-Operative Recovery & Pain Regimen')
    }
  }

  // Format printable medications for preview
  const printableMeds: PrintableMedication[] = medications.map((m) => ({
    name: m.name || 'Unspecified Drug',
    form: m.form,
    dosage: `${m.doseAmount} ${m.doseUnit}${m.strength ? ` (${m.strength})` : ''}`,
    route: m.routeTiming,
    frequency: FREQUENCY_MAP[m.frequency]?.label || m.frequency,
    schedule_times: m.scheduleTimes.join(', '),
    duration: m.duration,
    instructions: m.instructions || buildMedicationInstruction(m),
  }))

  // ─── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (planType === 'medication') {
      const validMeds = medications.filter((m) => m.name.trim())
      if (validMeds.length === 0) {
        setError('Please provide at least one medication name.')
        return
      }
    }

    setSubmitting(true)

    const scheduleValue = cadence.replace('_', ' ')
    const detailsValue =
      planType === 'checkin'
        ? indicationNotes.trim() || 'Check-in monitoring'
        : `${medications.filter((m) => m.name.trim()).length} medication(s) prescribed${
            indicationNotes ? ` — ${indicationNotes}` : ''
          }`

    let targetPlanId = existingPlanId

    if (isEditMode && existingPlanId) {
      // 1. Update existing care plan record in place
      const { error: updateError } = await supabase
        .from('care_plans')
        .update({
          doctor_id: doctorId,
          type: planType === 'medication' ? 'medication' : 'check_in',
          details: detailsValue,
          schedule: scheduleValue,
          active: true,
        })
        .eq('id', existingPlanId)

      if (updateError) {
        setError(updateError.message)
        setSubmitting(false)
        return
      }

      // Ensure all other care plans for this patient are inactive to avoid duplicates
      await supabase
        .from('care_plans')
        .update({ active: false })
        .eq('patient_id', patientId)
        .neq('id', existingPlanId)

      // Replace medications for this care plan
      await supabase
        .from('medications')
        .delete()
        .eq('care_plan_id', existingPlanId)

    } else {
      // Deactivate any prior plans to prevent duplicate active rows
      await supabase
        .from('care_plans')
        .update({ active: false })
        .eq('patient_id', patientId)

      const { data: planRow, error: planError } = await supabase
        .from('care_plans')
        .insert({
          patient_id: patientId,
          doctor_id: doctorId,
          type: planType === 'medication' ? 'medication' : 'check_in',
          details: detailsValue,
          schedule: scheduleValue,
          active: true,
        })
        .select('id')
        .single()

      if (planError || !planRow) {
        setError(planError?.message ?? 'Failed to create care plan.')
        setSubmitting(false)
        return
      }

      targetPlanId = planRow.id
    }

    // Insert medications if applicable
    if (planType === 'medication' && targetPlanId) {
      const medicationsToInsert = medications
        .filter((m) => m.name.trim())
        .map((m) => {
          const finalInstruction = m.instructions.trim() || buildMedicationInstruction(m)
          return {
            care_plan_id: targetPlanId,
            name: `${m.name.trim()}${m.form ? ` (${m.form})` : ''}`,
            dosage: `${m.doseAmount} ${m.doseUnit}${m.strength ? ` • ${m.strength}` : ''}`,
            schedule_times: m.scheduleTimes.join(', '),
            instructions: `${finalInstruction} • Route: ${m.routeTiming} • Duration: ${m.duration}`,
          }
        })

      if (medicationsToInsert.length > 0) {
        const { error: medsError } = await supabase
          .from('medications')
          .insert(medicationsToInsert)

        if (medsError) {
          setError(medsError.message)
          setSubmitting(false)
          return
        }
      }
    }

    // Send in-app notification to patient via server relay
    try {
      const doctorDisplayName = formatDoctorName(fullName, 'Your physician')
      await sendNotification({
        userId: patientId,
        title: isEditMode ? 'Care Plan Updated' : 'New Care Plan Prescribed',
        message: isEditMode
          ? `${doctorDisplayName} updated your Care Plan and prescriptions. Please review your updated medications and schedule.`
          : `${doctorDisplayName} created a new Care Plan for you. Please check your prescribed medications and instructions.`,
        type: 'care_plan_updated',
      })
      if (typeof window !== 'undefined') {
        localStorage.setItem('mediq_care_plan_has_unread', 'true')
        localStorage.setItem('mediq_care_plan_last_updated', new Date().toISOString())
        window.dispatchEvent(new CustomEvent('mediq_care_plan_updated'))
      }
    } catch (notifErr) {
      console.warn('Care plan notification notice:', notifErr)
    }

    router.push(`/doctor/patients/${patientId}`)
  }

  const handleDischargeDirect = async () => {
    if (!window.confirm('Are you sure you want to mark this treatment plan as completed and discharge the patient? This will archive active dose schedules.')) {
      return
    }
    setSubmitting(true)
    try {
      if (existingPlanId) {
        await supabase
          .from('care_plans')
          .update({
            active: false,
            details: `${indicationNotes ? `${indicationNotes} — ` : ''}[Discharged / Treatment Completed]`,
          })
          .eq('id', existingPlanId)
      }

      await supabase
        .from('enrollments')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('patient_id', patientId)
        .eq('doctor_id', doctorId)

      await sendNotification({
        userId: patientId,
        title: '🎉 Treatment Course Completed!',
        message: `${formatDoctorName(fullName, 'Your physician')} has marked your treatment plan as complete. Great job adhering to your regimen!`,
        type: 'care_plan',
      })

      router.push(`/doctor/patients/${patientId}`)
    } catch (err) {
      console.error(err)
      setError('Failed to discharge patient.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-text-muted">Loading Clinical Order System...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased text-primary">
      <DoctorSidebar fullName={fullName} specialty={specialty} activePage="My Patients" />
      <DoctorDesktopHeader fullName={fullName} />

      <main className="md:ml-[var(--doctor-sidebar-width,16rem)] flex flex-col pb-24 md:pb-12 pt-16 md:pt-0 transition-all duration-300 ease-in-out">
        <div className="max-w-[1200px] mx-auto w-full px-4 md:px-8 py-6 md:py-8">
          {/* Back Navigation */}
          <Link
            href={`/doctor/patients/${patientId}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline mb-4 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to Patient Clinical Profile
          </Link>

          {/* Page Header with Mode Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-subtle mb-6">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-accent text-[28px]">
                  {isEditMode ? 'edit_note' : 'clinical_notes'}
                </span>
                <h1 className="text-2xl font-bold text-primary">
                  {isEditMode ? 'Edit Care Plan & Prescriptions' : 'Clinical Care Plan & Prescription Order'}
                </h1>
              </div>
              <p className="text-xs md:text-sm text-text-muted mt-1">
                {isEditMode ? 'Modifying active care plan for ' : 'Prescribing for '}
                <strong className="text-primary">{patientName}</strong> (MRN: #{patientId.slice(0, 5).toUpperCase()})
              </p>
            </div>

            {/* View Switcher Tabs */}
            <div className="flex items-center bg-surface border border-border-subtle rounded-lg p-1 self-start sm:self-center shadow-sm">
              <button
                type="button"
                onClick={() => setActiveTab('matrix')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'matrix'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-muted hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">table_rows</span>
                Order Matrix
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'preview'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-muted hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">print</span>
                Print Preview
              </button>
            </div>
          </div>

          {activeTab === 'preview' ? (
            /* ── Live Printable Care Plan Preview ── */
            <div className="flex flex-col gap-6">
              <div className="bg-white border border-border-subtle rounded-xl p-4 flex items-center justify-between shadow-sm">
                <p className="text-xs text-text-muted">
                  This preview renders the official MEDIQ hospital prescription and care plan sheet that is printed at reception or sent to pharmacy dispensing.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('matrix')}
                  className="px-3 py-1.5 bg-surface-secondary border border-border-subtle hover:bg-border-subtle text-primary rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Edit Regimen
                </button>
              </div>

              <PrintableCarePlan
                patientName={patientName}
                patientId={patientId}
                doctorName={fullName}
                doctorSpecialty={specialty}
                planType={planType}
                schedule={cadence}
                medications={printableMeds}
              />
            </div>
          ) : (
            /* ── Interactive Clinical Care Plan Matrix ── */
            <form onSubmit={handleSubmit} className="flex flex-col gap-8">
              {/* 1. Select Plan Type */}
              <div className="bg-white border border-border-subtle rounded-xl p-5 md:p-6 shadow-sm">
                <h3 className="text-sm font-bold text-primary mb-3 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center text-xs font-bold">1</span>
                  Select Care Plan Protocol Type
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label
                    className={`block rounded-xl p-4 cursor-pointer border-2 transition-all ${
                      planType === 'medication'
                        ? 'border-accent bg-accent/5'
                        : 'border-border-subtle bg-white hover:border-text-muted/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan_type"
                      className="sr-only"
                      checked={planType === 'medication'}
                      onChange={() => setPlanType('medication')}
                    />
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-accent/15 text-accent flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[20px]">pill</span>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-primary block">
                          Medications &amp; Monitoring
                        </span>
                        <span className="text-xs text-text-muted mt-0.5 block">
                          Prescribe medications and schedule regular check-ins.
                        </span>
                      </div>
                    </div>
                  </label>

                  <label
                    className={`block rounded-xl p-4 cursor-pointer border-2 transition-all ${
                      planType === 'checkin'
                        ? 'border-accent bg-accent/5'
                        : 'border-border-subtle bg-white hover:border-text-muted/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan_type"
                      className="sr-only"
                      checked={planType === 'checkin'}
                      onChange={() => setPlanType('checkin')}
                    />
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-accent/15 text-accent flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[20px]">monitoring</span>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-primary block">
                          Check-Ins Only
                        </span>
                        <span className="text-xs text-text-muted mt-0.5 block">
                          Schedule regular check-ins without medications.
                        </span>
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* 2. Medications */}
              {planType === 'medication' && (
                <div className="bg-white border border-border-subtle rounded-xl p-5 md:p-6 shadow-sm flex flex-col gap-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-subtle">
                    <div>
                      <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center text-xs font-bold">2</span>
                        Prescribed Medications
                      </h3>
                      <p className="text-xs text-text-muted mt-0.5">
                        Add medications, dosages, and schedules.
                      </p>
                    </div>

                    {/* Quick Templates */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold text-text-muted mr-1">Templates:</span>
                      <button
                        type="button"
                        onClick={() => applyPreset('hypertension')}
                        className="px-2.5 py-1 bg-surface-secondary hover:bg-accent/10 hover:text-accent border border-border-subtle rounded text-[11px] font-semibold text-primary transition-colors cursor-pointer"
                      >
                        Hypertension
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset('diabetes')}
                        className="px-2.5 py-1 bg-surface-secondary hover:bg-accent/10 hover:text-accent border border-border-subtle rounded text-[11px] font-semibold text-primary transition-colors cursor-pointer"
                      >
                        Diabetes
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset('antibiotic')}
                        className="px-2.5 py-1 bg-surface-secondary hover:bg-accent/10 hover:text-accent border border-border-subtle rounded text-[11px] font-semibold text-primary transition-colors cursor-pointer"
                      >
                        Antibiotic
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset('postop')}
                        className="px-2.5 py-1 bg-surface-secondary hover:bg-accent/10 hover:text-accent border border-border-subtle rounded text-[11px] font-semibold text-primary transition-colors cursor-pointer"
                      >
                        Post-Op
                      </button>
                    </div>
                  </div>

                  {/* Desktop Tabular Grid */}
                  <div className="overflow-x-auto">
                    <datalist id="common-meds-list">
                      {COMMON_DRUGS.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>

                    <div className="min-w-[880px] flex flex-col gap-3">
                      {/* Grid Header */}
                      <div className="grid grid-cols-12 gap-2 text-[11px] font-bold uppercase tracking-wider text-text-muted px-3 py-2 bg-surface-secondary rounded-lg border border-border-subtle">
                        <div className="col-span-3">Medication Name &amp; Form</div>
                        <div className="col-span-3">Dose Intake &amp; Strength</div>
                        <div className="col-span-2">Frequency &amp; Alarms</div>
                        <div className="col-span-3">Route &amp; Duration</div>
                        <div className="col-span-1 text-right">Action</div>
                      </div>

                      {/* Grid Rows */}
                      {medications.map((row) => {
                        const availableUnits = FORM_DEFAULTS[row.form]?.units || [row.doseUnit || 'dose']

                        return (
                          <div
                            key={row.id}
                            className="grid grid-cols-12 gap-2 p-3 bg-white border border-border-subtle rounded-xl hover:border-accent/40 transition-colors shadow-xs"
                          >
                            {/* Col 1: Drug Name & Form */}
                            <div className="col-span-3 flex flex-col gap-1.5">
                              <input
                                type="text"
                                list="common-meds-list"
                                value={row.name}
                                onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                                placeholder="e.g. Paracetamol"
                                className="w-full px-2.5 py-1.5 border border-border-subtle rounded-lg text-xs font-semibold text-primary bg-background focus:bg-white"
                                required
                              />
                              <select
                                value={row.form}
                                onChange={(e) => updateRow(row.id, 'form', e.target.value)}
                                className="w-full px-2 py-1 border border-border-subtle rounded text-[11px] font-medium text-accent bg-accent/5 font-semibold"
                              >
                                {FORM_OPTIONS.map((f) => (
                                  <option key={f} value={f}>{f}</option>
                                ))}
                              </select>
                            </div>

                            {/* Col 2: Dose Intake & Strength */}
                            <div className="col-span-3 flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-text-muted font-bold">Take:</span>
                                <input
                                  type="text"
                                  value={row.doseAmount}
                                  onChange={(e) => updateRow(row.id, 'doseAmount', e.target.value)}
                                  placeholder="2"
                                  className="w-12 px-1.5 py-1 border border-border-subtle rounded text-xs font-bold text-center text-primary bg-background focus:bg-white"
                                  title="Number of units per intake (e.g. 2 tablets, 10 ml, 1 vial)"
                                />
                                <select
                                  value={row.doseUnit}
                                  onChange={(e) => updateRow(row.id, 'doseUnit', e.target.value)}
                                  className="flex-1 px-1.5 py-1 border border-border-subtle rounded text-[11px] font-medium text-primary bg-white truncate"
                                >
                                  {availableUnits.map((u) => (
                                    <option key={u} value={u}>{u}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-text-muted font-bold">Strength:</span>
                                <input
                                  type="text"
                                  value={row.strength}
                                  onChange={(e) => updateRow(row.id, 'strength', e.target.value)}
                                  placeholder="e.g. 500 mg, 125mg/5ml"
                                  className="flex-1 px-2 py-1 border border-border-subtle rounded text-[11px] text-primary bg-background focus:bg-white"
                                  title="Drug strength or concentration per unit (e.g. 500 mg, 1g, 125mg/5ml)"
                                />
                              </div>
                            </div>

                            {/* Col 3: Frequency & Alarm Timestamps */}
                            <div className="col-span-2 flex flex-col gap-1.5">
                              <select
                                value={row.frequency}
                                onChange={(e) => updateRow(row.id, 'frequency', e.target.value)}
                                className="w-full px-2 py-1 border border-border-subtle rounded text-xs font-semibold text-primary bg-white"
                              >
                                {Object.entries(FREQUENCY_MAP).map(([k, v]) => (
                                  <option key={k} value={k}>{v.label}</option>
                                ))}
                              </select>
                              <div className="flex flex-wrap gap-1">
                                {row.scheduleTimes.map((t, tIdx) => (
                                  <span
                                    key={tIdx}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-accent/10 border border-accent/20 rounded text-[10px] font-mono font-bold text-accent"
                                  >
                                    <span className="material-symbols-outlined text-[10px]">alarm</span>
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Col 4: Route Timing & Duration */}
                            <div className="col-span-3 flex flex-col gap-1.5">
                              <select
                                value={row.routeTiming}
                                onChange={(e) => updateRow(row.id, 'routeTiming', e.target.value)}
                                className="w-full px-2 py-1 border border-border-subtle rounded text-[11px] text-primary bg-white truncate"
                              >
                                {ROUTE_TIMING_OPTIONS.map((r) => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                              <select
                                value={row.duration}
                                onChange={(e) => updateRow(row.id, 'duration', e.target.value)}
                                className="w-full px-2 py-1 border border-border-subtle rounded text-[11px] text-text-muted bg-white"
                              >
                                {DURATION_OPTIONS.map((d) => (
                                  <option key={d} value={d}>{d}</option>
                                ))}
                              </select>
                            </div>

                            {/* Col 5: Row Action */}
                            <div className="col-span-1 flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => removeRow(row.id)}
                                disabled={medications.length <= 1}
                                className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted cursor-pointer"
                                title="Remove medication"
                              >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            </div>

                            {/* Clinical Instructions Subrow with Patient Preview */}
                            <div className="col-span-12 pt-2 border-t border-border-subtle flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-accent text-[15px]">clinical_notes</span>
                                <input
                                  type="text"
                                  value={row.instructions}
                                  onChange={(e) => updateRow(row.id, 'instructions', e.target.value)}
                                  placeholder="Patient directions (e.g. Take 2 tablets twice daily with water...)"
                                  className="flex-1 px-2.5 py-1 text-xs border border-border-subtle rounded bg-background focus:bg-white text-primary font-medium"
                                />
                              </div>
                              <p className="text-[10px] text-emerald-800 bg-emerald-50/70 border border-emerald-200/60 rounded px-2.5 py-1 font-medium flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[12px] text-emerald-600">visibility</span>
                                <span>Patient sees: <strong>{row.instructions || buildMedicationInstruction(row)}</strong></span>
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Add Row Button */}
                  <button
                    type="button"
                    onClick={addRow}
                    className="w-full py-3 border-2 border-dashed border-border-subtle rounded-xl text-xs font-bold text-accent hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">add_circle</span>
                    + Add Another Medication
                  </button>
                </div>
              )}

              {/* 3. Check-In Frequency & Notes */}
              <div className="bg-white border border-border-subtle rounded-xl p-5 md:p-6 shadow-sm flex flex-col gap-5">
                <div>
                  <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center text-xs font-bold">
                      {planType === 'medication' ? '3' : '2'}
                    </span>
                    Check-In Frequency
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    How often the patient should complete a recovery check-in.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  {cadenceOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCadence(opt.value)}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        cadence === opt.value
                          ? 'bg-accent text-white border-accent shadow-sm'
                          : 'bg-white text-primary border-border-subtle hover:border-text-muted/40'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1 pt-2">
                  <label className="text-xs font-bold text-primary">
                    Notes / Diagnosis (Optional)
                  </label>
                  <input
                    type="text"
                    value={indicationNotes}
                    onChange={(e) => setIndicationNotes(e.target.value)}
                    placeholder="e.g. Hypertension check, post-op recovery..."
                    className="w-full p-2.5 border border-border-subtle rounded-lg text-xs bg-background focus:bg-white text-primary"
                  />
                </div>
              </div>

              {/* Error Notification */}
              {error && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
                {isEditMode && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleDischargeDirect}
                    className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="Mark treatment course complete and discharge patient"
                  >
                    <span className="material-symbols-outlined text-[16px] text-emerald-700">task_alt</span>
                    Mark Treatment Complete &amp; Discharge
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className="px-5 py-2.5 bg-white border border-border-subtle hover:bg-surface-secondary text-primary rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  Preview Print Layout
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 bg-accent hover:bg-[#0c704d] disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  {submitting
                    ? isEditMode
                      ? 'Saving Changes...'
                      : 'Creating Care Plan...'
                    : isEditMode
                    ? 'Save Updated Care Plan'
                    : 'Finalize & Issue Care Plan'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}