'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/shared/supabase'
import { formatDoctorName } from '@/shared/utils'
import { PendingInvite, EnrollPatientModalProps } from '../types'

// Generate unambiguous 4-character suffix (no O, 0, I, 1, L)
function generateRandomCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let result = ''
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `MED-${result}`
}

export default function EnrollPatientModal({
  isOpen,
  onClose,
  doctorId,
  doctorName,
  doctorSpecialty = 'Attending Physician',
  onEnrollmentCreated,
}: EnrollPatientModalProps) {
  const [activeTab, setActiveTab] = useState<'generate' | 'pending'>('generate')

  // Form State
  const [inviteCode, setInviteCode] = useState(generateRandomCode)
  const [patientName, setPatientName] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [initialNotes, setInitialNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdInvite, setCreatedInvite] = useState<PendingInvite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedSms, setCopiedSms] = useState(false)

  // Pending Invites State
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [loadingPending, setLoadingPending] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // Get base URL for links
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin)
    }
  }, [])

  const loadPendingInvites = useCallback(async () => {
    if (!doctorId) return
    setLoadingPending(true)
    try {
      const { data, error: fetchErr } = await supabase
        .from('enrollments')
        .select('*')
        .eq('doctor_id', doctorId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (!fetchErr && data) {
        setPendingInvites(data)
      }
    } catch {
      // Graceful silence if table not yet migrated
    } finally {
      setLoadingPending(false)
    }
  }, [doctorId])

  useEffect(() => {
    if (isOpen) {
      setInviteCode(generateRandomCode())
      setCreatedInvite(null)
      setError(null)
      setCopied(false)
      loadPendingInvites()
    }
  }, [isOpen, loadPendingInvites])

  if (!isOpen) return null

  const inviteUrl = `${origin}/signup?code=${createdInvite ? createdInvite.invite_code : inviteCode}`

  const whatsappMessage = encodeURIComponent(
    `Hello${patientName.trim() ? ` ${patientName.trim()}` : ''}, ${formatDoctorName(doctorName)} has enrolled you on MEDIQ for post-encounter follow-up care.\n\nPlease complete your registration here to connect with your care plan:\n${inviteUrl}\n\nYour enrollment code: ${createdInvite ? createdInvite.invite_code : inviteCode}`
  )

  const whatsappUrl = patientPhone.trim()
    ? `https://api.whatsapp.com/send?phone=${patientPhone.replace(/\D/g, '')}&text=${whatsappMessage}`
    : `https://api.whatsapp.com/send?text=${whatsappMessage}`

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopySmsText = () => {
    const text = `${formatDoctorName(doctorName)} has enrolled you on MEDIQ for clinical follow-up. Register here: ${inviteUrl} (Code: ${createdInvite ? createdInvite.invite_code : inviteCode})`
    navigator.clipboard.writeText(text)
    setCopiedSms(true)
    setTimeout(() => setCopiedSms(false), 2000)
  }

  const handlePrintSlip = () => {
    window.print()
  }

  // Create enrollment with auto-retry collision resolution
  const handleGenerateAndSave = async () => {
    if (!doctorId) {
      setError('Doctor session not authenticated')
      return
    }

    setCreating(true)
    setError(null)

    let currentCode = inviteCode
    let attempts = 0
    const maxAttempts = 3
    let success = false
    let lastErrorMsg = ''

    while (attempts < maxAttempts && !success) {
      attempts++
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

      const { data, error: insertErr } = await supabase
        .from('enrollments')
        .insert({
          doctor_id: doctorId,
          invite_code: currentCode,
          patient_name: patientName.trim() || null,
          patient_phone: patientPhone.trim() || null,
          initial_notes: initialNotes.trim() || null,
          status: 'pending',
          expires_at: expiresAt,
        })
        .select()
        .single()

      if (!insertErr && data) {
        success = true
        setCreatedInvite(data)
        loadPendingInvites()
        if (onEnrollmentCreated) onEnrollmentCreated()
        break
      }

      // Check if duplicate key collision (23505) -> auto-retry with a freshly generated code
      if (insertErr?.code === '23505' || insertErr?.message?.includes('duplicate key') || insertErr?.message?.includes('unique constraint')) {
        console.warn(`Enrollment code collision on ${currentCode}. Retrying attempt ${attempts}...`)
        currentCode = generateRandomCode()
        setInviteCode(currentCode)
        continue
      }

      // Table schema not yet created in Supabase
      if (insertErr?.code === 'PGRST204' || insertErr?.message?.includes('does not exist') || insertErr?.message?.includes('schema cache')) {
        lastErrorMsg = 'Database table "enrollments" is pending migration in Supabase SQL editor. Please execute the migration script.'
        break
      }

      lastErrorMsg = insertErr?.message || 'Failed to save enrollment invite'
      break
    }

    setCreating(false)
    if (!success) {
      setError(lastErrorMsg)
    }
  }

  const handleRevokeInvite = async (id: string) => {
    setRevokingId(id)
    try {
      const { error: delErr } = await supabase
        .from('enrollments')
        .update({ status: 'discontinued', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('doctor_id', doctorId)

      if (!delErr) {
        setPendingInvites((prev) => prev.filter((p) => p.id !== id))
        if (onEnrollmentCreated) onEnrollmentCreated()
      }
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <>
      {/* ── Modal Backdrop & Dialog ─────────────────────── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 overflow-y-auto print:hidden">
        <div className="relative w-full max-w-[620px] bg-white rounded-2xl shadow-2xl border border-border-subtle overflow-hidden flex flex-col my-8 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="p-6 pb-4 border-b border-border-subtle flex items-start justify-between bg-surface-secondary/40">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent/10 text-accent font-bold text-xs">
                  MQ
                </span>
                <h2 className="text-xl font-bold text-primary tracking-tight">
                  Enroll Patient
                </h2>
              </div>
              <p className="text-xs text-text-muted">
                Create an invite code so your patient can sign up and connect with you.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-primary hover:bg-surface-secondary transition-colors cursor-pointer"
              title="Close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-border-subtle px-6 bg-white gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('generate')}
              className={`py-3 text-xs font-semibold tracking-wide uppercase transition-colors relative cursor-pointer ${
                activeTab === 'generate'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-primary'
              }`}
            >
              New Invite
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              className={`py-3 text-xs font-semibold tracking-wide uppercase transition-colors relative flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'pending'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-primary'
              }`}
            >
              Pending Invites
              {pendingInvites.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-accent/10 text-accent">
                  {pendingInvites.length}
                </span>
              )}
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
            {error && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[18px] shrink-0 text-red-600">error</span>
                <div className="leading-relaxed">
                  <p className="font-semibold">Unable to create invite</p>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {activeTab === 'generate' ? (
              <>
                {/* 1. Instant Invite Code Display */}
                <div className="p-5 bg-gradient-to-br from-surface-secondary/80 to-surface-secondary/30 rounded-xl border border-border-subtle flex flex-col items-center justify-center text-center">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
                    Invite Code
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl md:text-4xl font-mono font-extrabold tracking-widest text-primary selection:bg-accent selection:text-white">
                      {createdInvite ? createdInvite.invite_code : inviteCode}
                    </span>
                    {!createdInvite && (
                      <button
                        type="button"
                        onClick={() => setInviteCode(generateRandomCode())}
                        title="Generate different code"
                        className="w-8 h-8 rounded-lg border border-border-subtle bg-white hover:bg-surface-secondary flex items-center justify-center text-text-muted hover:text-primary transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-text-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span>Valid for 14 days</span>
                    <span>•</span>
                    <span>{formatDoctorName(doctorName)}</span>
                  </div>
                </div>

                {/* 2. Optional Quick Identification */}
                {!createdInvite ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                          Phone <span className="font-normal lowercase text-text-muted">(optional)</span>
                        </label>
                        <input
                          type="tel"
                          value={patientPhone}
                          onChange={(e) => setPatientPhone(e.target.value)}
                          placeholder="e.g. +234 803 123 4567"
                          className="w-full px-3.5 py-2.5 bg-white border border-border-subtle rounded-xl text-sm text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                          Patient Name <span className="font-normal lowercase text-text-muted">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={patientName}
                          onChange={(e) => setPatientName(e.target.value)}
                          placeholder="e.g. Mary Okoro"
                          className="w-full px-3.5 py-2.5 bg-white border border-border-subtle rounded-xl text-sm text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent transition-all"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                        Note <span className="font-normal lowercase text-text-muted">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={initialNotes}
                        onChange={(e) => setInitialNotes(e.target.value)}
                        placeholder="e.g. Post-discharge check, wound review..."
                        className="w-full px-3.5 py-2.5 bg-white border border-border-subtle rounded-xl text-sm text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent transition-all"
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={handleGenerateAndSave}
                        disabled={creating}
                        className="w-full py-3 px-4 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {creating ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Creating Invite...</span>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
                            <span>Save &amp; Share Code</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 3. Post-Issue 1-Tap Handoff Actions */
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs text-emerald-800">
                      <span className="material-symbols-outlined text-emerald-600 text-[18px]">check_circle</span>
                      <span>Invite created! Share the code or link with your patient.</span>
                    </div>

                    <div className="space-y-2.5">
                      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider">
                        Share with Patient
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {/* 1. Copy Direct Link */}
                        <button
                          type="button"
                          onClick={handleCopyLink}
                          className="p-3 bg-surface-secondary/70 hover:bg-surface-secondary border border-border-subtle rounded-xl flex items-center gap-3 transition-colors text-left cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-lg bg-white text-primary border border-border-subtle flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[18px]">
                              {copied ? 'done' : 'link'}
                            </span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-primary">
                              {copied ? 'Link Copied!' : 'Copy Link'}
                            </p>
                            <p className="text-[10px] text-text-muted">Direct signup link</p>
                          </div>
                        </button>

                        {/* 2. WhatsApp Share */}
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-3 bg-surface-secondary/70 hover:bg-surface-secondary border border-border-subtle rounded-xl flex items-center gap-3 transition-colors text-left cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-lg bg-[#25D366]/15 text-[#25D366] border border-[#25D366]/20 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[18px]">chat</span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-primary">WhatsApp</p>
                            <p className="text-[10px] text-text-muted">Send invite message</p>
                          </div>
                        </a>

                        {/* 3. Copy SMS Text */}
                        <button
                          type="button"
                          onClick={handleCopySmsText}
                          className="p-3 bg-surface-secondary/70 hover:bg-surface-secondary border border-border-subtle rounded-xl flex items-center gap-3 transition-colors text-left cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-lg bg-white text-primary border border-border-subtle flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[18px]">
                              {copiedSms ? 'done' : 'sms'}
                            </span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-primary">
                              {copiedSms ? 'SMS Copied!' : 'Copy SMS'}
                            </p>
                            <p className="text-[10px] text-text-muted">Plain text invite</p>
                          </div>
                        </button>

                        {/* 4. Print Handoff Slip */}
                        <button
                          type="button"
                          onClick={handlePrintSlip}
                          className="p-3 bg-surface-secondary/70 hover:bg-surface-secondary border border-border-subtle rounded-xl flex items-center gap-3 transition-colors text-left cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-lg bg-white text-primary border border-border-subtle flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[18px]">print</span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-primary">Print Slip</p>
                            <p className="text-[10px] text-text-muted">Paper copy for patient</p>
                          </div>
                        </button>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-border-subtle flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setCreatedInvite(null)
                          setInviteCode(generateRandomCode())
                          setPatientName('')
                          setPatientPhone('')
                          setInitialNotes('')
                        }}
                        className="text-xs font-semibold text-text-muted hover:text-primary transition-colors cursor-pointer"
                      >
                        + Enroll Another Patient
                      </button>

                      <button
                        type="button"
                        onClick={onClose}
                        className="py-2.5 px-5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 transition-all cursor-pointer"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* ── Tab 2: Pending Invites List ───────────────────── */
              <div className="space-y-3">
                {loadingPending ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2">
                    <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-text-muted">Loading pending invitations...</p>
                  </div>
                ) : pendingInvites.length === 0 ? (
                  <div className="py-12 text-center text-text-muted">
                    <span className="material-symbols-outlined text-4xl text-text-muted/40 mb-2">
                      mark_email_read
                    </span>
                    <p className="text-sm font-semibold text-primary">No Pending Invitations</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      All issued codes have either been registered or expired.
                    </p>
                  </div>
                ) : (
                  pendingInvites.map((invite) => {
                    const isExpiringSoon =
                      new Date(invite.expires_at).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000
                    const daysLeft = Math.max(
                      0,
                      Math.ceil(
                        (new Date(invite.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
                      )
                    )

                    return (
                      <div
                        key={invite.id}
                        className="p-3.5 bg-surface-secondary/40 border border-border-subtle rounded-xl flex items-center justify-between gap-3"
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-bold text-primary">
                              {invite.invite_code}
                            </span>
                            {invite.patient_name && (
                              <span className="text-xs font-medium text-text-muted">
                                ({invite.patient_name})
                              </span>
                            )}
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                isExpiringSoon
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-surface-secondary text-text-muted'
                              }`}
                            >
                              {daysLeft}d left
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted">
                            Issued on {new Date(invite.created_at).toLocaleDateString()}
                            {invite.patient_phone ? ` • ${invite.patient_phone}` : ''}
                            {invite.initial_notes ? ` • "${invite.initial_notes}"` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`${origin}/signup?code=${invite.invite_code}`)
                              alert(`Copied link for ${invite.invite_code}`)
                            }}
                            className="p-1.5 text-text-muted hover:text-accent hover:bg-white rounded-lg border border-transparent hover:border-border-subtle transition-all cursor-pointer"
                            title="Copy Signup Link"
                          >
                            <span className="material-symbols-outlined text-[18px]">content_copy</span>
                          </button>

                          <button
                            type="button"
                            disabled={revokingId === invite.id}
                            onClick={() => handleRevokeInvite(invite.id)}
                            className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 transition-all cursor-pointer"
                            title="Revoke Invite"
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {revokingId === invite.id ? 'hourglass_empty' : 'delete'}
                            </span>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Printable Patient Discharge Slip (Hidden on screen, visible on print) ── */}
      <div className="hidden print:block fixed inset-0 bg-white p-8 font-sans text-black">
        <div className="max-w-[480px] mx-auto border-2 border-black p-6 rounded-lg space-y-4">
          <div className="border-b-2 border-black pb-3 text-center">
            <h1 className="text-xl font-black uppercase tracking-wider">MEDIQ Clinical Systems</h1>
            <p className="text-xs uppercase tracking-widest text-gray-600">
              Post-Encounter Follow-Up Protocol
            </p>
          </div>

          <div className="text-xs space-y-1">
            <p><strong>Attending Physician:</strong> {formatDoctorName(doctorName)} ({doctorSpecialty})</p>
            {patientName && <p><strong>Patient Name/MRN:</strong> {patientName}</p>}
            <p><strong>Issue Date:</strong> {new Date().toLocaleDateString()}</p>
          </div>

          <div className="my-6 p-4 border border-dashed border-black text-center bg-gray-50">
            <p className="text-[10px] uppercase font-bold tracking-widest text-gray-600 mb-1">
              Your Enrollment Access Code
            </p>
            <p className="text-4xl font-mono font-black tracking-widest">
              {createdInvite ? createdInvite.invite_code : inviteCode}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">Valid for 14 days from consultation</p>
          </div>

          <div className="text-xs space-y-1.5 leading-relaxed">
            <p className="font-bold">Instructions for Patient:</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Visit: <strong>{origin}/signup</strong> on your phone or computer.</li>
              <li>Enter the 6-character code above to link with your doctor.</li>
              <li>View your prescribed medication schedule, dose alarms, and recovery check-ins.</li>
            </ol>
          </div>

          <div className="pt-6 border-t border-black text-center text-[10px] text-gray-500">
            MEDIQ Digital Health System • Confidential Patient Handoff
          </div>
        </div>
      </div>
    </>
  )
}
