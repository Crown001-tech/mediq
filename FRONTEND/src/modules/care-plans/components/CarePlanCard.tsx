import Link from 'next/link'

export type CarePlanCardProps = {
  type: string
  details: string
  schedule: string
  medicationCount?: number
}

export default function CarePlanCard({ type, details, schedule, medicationCount = 0 }: CarePlanCardProps) {
  const isMedication = type === 'medication'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center border-b border-border-subtle pb-2">
        <h3 className="text-lg font-semibold text-primary">Care Plan</h3>
        <Link href="/care-plan" className="text-sm text-accent hover:underline">
          View All
        </Link>
      </div>

      <div className="bg-white border border-border-subtle rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-surface-secondary p-2 rounded-lg">
            <span className="material-symbols-outlined text-accent text-[24px]">
              {isMedication ? 'medication' : 'event_available'}
            </span>
          </div>
          <div className="flex flex-col">
            <h4 className="text-base font-semibold text-primary capitalize">
              {type.replace('_', ' ')} Plan
            </h4>
            {isMedication && medicationCount > 0 && (
              <span className="text-xs text-text-muted">
                {medicationCount} medication{medicationCount !== 1 ? 's' : ''} prescribed
              </span>
            )}
          </div>
        </div>

        <div className="bg-background border border-border-subtle rounded-lg p-3">
          {isMedication && medicationCount > 0 ? (
            <p className="text-sm text-primary">
              <strong>{medicationCount} medication{medicationCount !== 1 ? 's' : ''}</strong> — check-in <span className="capitalize">{schedule}</span>
            </p>
          ) : (
            <p className="text-sm text-primary">
              <strong>{details}</strong> — {schedule}
            </p>
          )}
        </div>

        <Link
          href="/care-plan"
          className="text-sm text-accent flex items-center justify-center gap-1 hover:underline pt-1"
        >
          View Full Plan
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </Link>
      </div>
    </div>
  )
}
