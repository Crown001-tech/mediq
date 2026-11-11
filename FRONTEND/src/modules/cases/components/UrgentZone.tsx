'use client'

import Link from 'next/link'
import { UrgentZoneProps } from '../types'

export default function UrgentZone({ hospitalAlert, doseReminder }: UrgentZoneProps) {
  if (!hospitalAlert && !doseReminder) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      {hospitalAlert && (
        <div className="bg-white border-2 border-red-600 rounded-xl p-4 md:p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-red-100 text-red-700 p-2 rounded-full flex-shrink-0 animate-pulse">
              <span className="material-symbols-outlined text-[20px]">emergency</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-red-600 mb-1">Action Required</h3>
              <p className="text-sm text-primary leading-snug">{hospitalAlert}</p>
            </div>
          </div>
          <Link
            href="/appointments"
            className="w-full bg-white border border-red-300 text-red-600 text-sm font-semibold py-2.5 rounded-lg hover:bg-red-50 transition-colors text-center"
          >
            View Appointments
          </Link>
        </div>
      )}

      {doseReminder && (
        <div className="bg-white border-2 border-accent rounded-xl p-4 md:p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-surface-secondary text-accent p-2 rounded-full flex-shrink-0">
              <span className="material-symbols-outlined text-[20px]">medication</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-accent mb-1">Upcoming Medication</h3>
              <p className="text-sm text-primary leading-snug">{doseReminder}</p>
            </div>
          </div>
          <Link
            href="/log-dose"
            className="w-full bg-accent text-white text-sm font-semibold py-2.5 rounded-lg hover:opacity-90 transition-colors text-center"
          >
            Log Dose Now
          </Link>
        </div>
      )}
    </div>
  )
}
