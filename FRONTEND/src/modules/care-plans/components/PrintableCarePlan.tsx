'use client'

import React from 'react'
import { formatDoctorName } from '@/shared/utils'
import { PrintableMedication } from '../types'

export type PrintableCarePlanProps = {
  patientName: string
  patientId: string
  demographics?: string
  doctorName: string
  doctorSpecialty?: string
  planType: 'medication' | 'checkin' | string
  schedule: string
  details?: string
  carePlanId?: string
  createdAt?: string
  medications: PrintableMedication[]
  onClose?: () => void
  isModal?: boolean
}

export default function PrintableCarePlan({
  patientName,
  patientId,
  demographics = 'Adult Patient',
  doctorName,
  doctorSpecialty = 'General Medicine',
  planType,
  schedule,
  details,
  carePlanId,
  createdAt,
  medications = [],
  onClose,
  isModal = false,
}: PrintableCarePlanProps) {
  const issueDate = createdAt ? new Date(createdAt) : new Date()
  const formattedDate = issueDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const formattedTime = issueDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const planRefNumber = carePlanId
    ? `CP-${carePlanId.slice(0, 8).toUpperCase()}`
    : `CP-${patientId.slice(0, 5).toUpperCase()}-${Date.now().toString().slice(-4)}`

  const handlePrint = () => {
    window.print()
  }

  const content = (
    <div className="printable-care-plan-sheet bg-white text-[#111111] font-sans p-6 md:p-10 max-w-[850px] mx-auto border border-[#D0DCDC] rounded-xl shadow-md print:shadow-none print:border-none print:p-4 print:max-w-none print:w-full print:m-0">
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printable-care-plan-sheet,
          .printable-care-plan-sheet * {
            visibility: visible;
          }
          .printable-care-plan-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            margin: 0 !important;
            padding: 16px !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4 portrait;
            margin: 12mm;
          }
        }
      `}</style>

      {/* Screen action header */}
      <div className="no-print flex items-center justify-between pb-6 mb-6 border-b border-[#E0E8E6]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0F8A5F] text-[24px]">print</span>
          <div>
            <h2 className="text-base font-bold text-primary">Print &amp; Export Care Plan</h2>
            <p className="text-xs text-text-muted">Standard Clinical Prescription &amp; Regimen Protocol</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0F8A5F] hover:bg-[#0c704d] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            Print / Save as PDF
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center p-2 text-text-muted hover:text-primary hover:bg-[#F4F8F7] rounded-lg transition-colors cursor-pointer"
              title="Close Preview"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Official Hospital Document Header ────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-6 border-b-2 border-[#111111]">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#0F8A5F] text-white flex items-center justify-center font-bold text-sm tracking-wider">
              M
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-[#111111] uppercase leading-none">
                MEDIQ Health System
              </h1>
              <span className="text-[10px] font-semibold text-[#0F8A5F] tracking-widest uppercase block mt-0.5">
                Hospital Clinical Care Plan &amp; Prescription Protocol
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[#5F5F5F] mt-2">
            Clinical Registry &bull; Pharmacy Dispense &bull; Asynchronous Telehealth Network
          </p>
        </div>

        <div className="text-left sm:text-right text-xs">
          <div className="inline-block bg-[#F4F8F7] border border-[#E0E8E6] rounded px-2.5 py-1 text-left sm:text-right">
            <p className="text-[10px] uppercase font-bold text-[#5F5F5F]">Document Ref</p>
            <p className="font-mono font-bold text-[#111111] text-xs">{planRefNumber}</p>
          </div>
          <p className="text-[11px] text-[#5F5F5F] mt-1.5">
            Issued: <span className="font-semibold text-[#111111]">{formattedDate} {formattedTime}</span>
          </p>
        </div>
      </div>

      {/* ── Patient & Physician Clinical Information Grid ─────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-b border-[#E0E8E6] text-xs bg-[#F9FBFA] px-4 rounded-lg my-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#5F5F5F] mb-1">
            Patient Information
          </p>
          <p className="text-sm font-bold text-[#111111]">{patientName}</p>
          <div className="flex items-center gap-3 text-[11px] text-[#5F5F5F] mt-0.5">
            <span>MRN: <strong className="font-mono text-[#111111]">#{patientId.slice(0, 8).toUpperCase()}</strong></span>
            <span>&bull;</span>
            <span>{demographics}</span>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#5F5F5F] mb-1">
            Attending Physician
          </p>
          <p className="text-sm font-bold text-[#111111]">
            {formatDoctorName(doctorName)}
          </p>
          <div className="flex items-center gap-3 text-[11px] text-[#5F5F5F] mt-0.5">
            <span>Specialty: <strong className="text-[#111111]">{doctorSpecialty}</strong></span>
            <span>&bull;</span>
            <span className="text-[#0F8A5F] font-semibold">Verified License</span>
          </div>
        </div>
      </div>

      {/* ── Plan Overview & Cadence ───────────────────────────── */}
      <div className="flex items-center justify-between text-xs py-2 px-1 mb-4">
        <div>
          <span className="text-[10px] font-bold uppercase text-[#5F5F5F]">Plan Type: </span>
          <span className="font-bold text-[#111111] capitalize">
            {planType === 'medication' ? 'Pharmacological Regimen & Monitoring' : 'Clinical Check-In Monitoring'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 bg-[#0F8A5F]/10 text-[#0F8A5F] px-2.5 py-1 rounded-full font-semibold text-[11px]">
          <span className="material-symbols-outlined text-[14px]">event_repeat</span>
          <span>Check-in Cadence: <strong className="capitalize">{schedule.replace('_', ' ')}</strong></span>
        </div>
      </div>

      {/* ── Tabular Medication Regimen Matrix ─────────────────── */}
      {planType === 'medication' && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#111111] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#0F8A5F] text-[16px]">pill</span>
              Medication Administration &amp; Dosage Matrix
            </h3>
            <span className="text-[11px] text-[#5F5F5F]">{medications.length} Prescribed Item{medications.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="overflow-x-auto border border-[#111111] rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#111111] text-white text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3 w-8 text-center border-r border-[#333333]">#</th>
                  <th className="py-2.5 px-3 border-r border-[#333333]">Medication &amp; Form</th>
                  <th className="py-2.5 px-3 border-r border-[#333333]">Dose / Strength</th>
                  <th className="py-2.5 px-3 border-r border-[#333333]">Frequency &amp; Times</th>
                  <th className="py-2.5 px-3 border-r border-[#333333]">Duration</th>
                  <th className="py-2.5 px-3">Administration &amp; Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E0E8E6]">
                {medications.map((med, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'bg-[#F9FBFA]' : 'bg-white'}>
                    <td className="py-3 px-3 text-center font-bold text-[#5F5F5F] border-r border-[#E0E8E6] align-top">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-3 font-bold text-[#111111] border-r border-[#E0E8E6] align-top">
                      <div>{med.name}</div>
                      {med.form && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-normal bg-[#E8F1EE] text-[#0F8A5F]">
                          {med.form}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-semibold text-[#111111] border-r border-[#E0E8E6] align-top whitespace-nowrap">
                      {med.dosage || 'As directed'}
                    </td>
                    <td className="py-3 px-3 border-r border-[#E0E8E6] align-top">
                      <div className="font-semibold text-[#111111]">{med.frequency || 'Scheduled'}</div>
                      {med.schedule_times && (
                        <div className="text-[11px] text-[#0F8A5F] font-mono mt-0.5 font-medium">
                          {med.schedule_times}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 border-r border-[#E0E8E6] align-top whitespace-nowrap text-[#5F5F5F]">
                      {med.duration || 'Ongoing'}
                    </td>
                    <td className="py-3 px-3 text-[#111111] align-top text-[11px] leading-relaxed">
                      {med.instructions || 'Take as advised with water.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Check-In & Patient Compliance Protocol ────────────── */}
      <div className="bg-[#F4F8F7] border border-[#E0E8E6] rounded-lg p-3.5 mb-6 text-xs">
        <h4 className="font-bold text-[#111111] uppercase tracking-wider text-[10px] mb-1 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[#0F8A5F] text-[15px]">monitoring</span>
          Patient Monitoring &amp; Compliance Protocol
        </h4>
        <ul className="list-disc list-inside space-y-1 text-[#333333] text-[11px]">
          <li>
            <strong>Dose Logging:</strong> Record each dose in the MEDIQ portal or mobile interface at scheduled intervals.
          </li>
          <li>
            <strong>Scheduled Check-In:</strong> Complete asynchronous medical check-in report every{' '}
            <strong className="capitalize">{schedule.replace('_', ' ')}</strong> to monitor therapeutic efficacy.
          </li>
          <li>
            <strong>Adverse Effect Caution:</strong> If acute symptoms occur (severe chest pain, dyspnea, sudden rash, extreme dizziness), report immediately to hospital emergency triage.
          </li>
        </ul>
      </div>

      {/* ── Official Handoff & Validation Signatures ──────────── */}
      <div className="pt-4 border-t border-[#111111] grid grid-cols-2 gap-6 text-xs">
        {/* Doctor Signature */}
        <div className="border border-[#D0DCDC] rounded p-3 bg-white">
          <p className="text-[10px] font-bold uppercase text-[#5F5F5F] mb-4">
            Prescribing Physician Sign-Off
          </p>
          <div className="font-serif italic text-base text-[#111111] min-h-[30px] border-b border-dashed border-[#888888] pb-1 flex items-end">
            {formatDoctorName(doctorName)}
          </div>
          <div className="flex justify-between items-center text-[10px] text-[#5F5F5F] mt-1.5">
            <span>Medical License Verified</span>
            <span>Date: {formattedDate}</span>
          </div>
        </div>

        {/* Pharmacy Dispense Stamp Box */}
        <div className="border border-[#D0DCDC] rounded p-3 bg-white">
          <p className="text-[10px] font-bold uppercase text-[#5F5F5F] mb-4">
            Pharmacy Dispense &bull; Verification Seal
          </p>
          <div className="min-h-[30px] border-b border-dashed border-[#888888] pb-1 flex items-end justify-between text-[11px] text-[#5F5F5F]">
            <span className="italic">Dispensed by: _________________</span>
            <span className="font-mono text-[9px]">RX-BATCH VALID</span>
          </div>
          <div className="flex justify-between items-center text-[10px] text-[#5F5F5F] mt-1.5">
            <span>Hospital Outpatient Pharmacy</span>
            <span>Date: ___ / ___ / 2026</span>
          </div>
        </div>
      </div>

      {/* Footer disclaimer */}
      <div className="mt-5 pt-3 border-t border-[#E0E8E6] flex flex-col sm:flex-row justify-between items-center gap-2 text-[10px] text-[#777777]">
        <p>&copy; {new Date().getFullYear()} MEDIQ Health Information System. Printed for Clinical Chart &amp; Patient Records.</p>
        <p className="font-mono">Security Hash: {patientId.slice(0, 4)}-{Date.now().toString().slice(-6)}</p>
      </div>
    </div>
  )

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 print:p-0 print:bg-white print:static print:overflow-visible">
        <div className="relative w-full max-w-[900px] my-6 print:m-0 print:max-w-none">
          {content}
        </div>
      </div>
    )
  }

  return content
}
