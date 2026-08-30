type CarePlanCardProps = {
  type: string
  details: string
  schedule: string
}

export default function CarePlanCard({ type, details, schedule }: CarePlanCardProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center border-b border-border-subtle pb-2">
        <h3 className="text-lg font-semibold text-primary">Care Plan</h3>
        <a href="/care-plan" className="text-sm text-accent hover:underline">
          View All
        </a>
      </div>

      <div className="bg-white border border-border-subtle rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-surface-secondary p-2 rounded-lg">
            <span className="material-symbols-outlined text-accent text-[24px]">favorite</span>
          </div>
          <h4 className="text-base font-semibold text-primary capitalize">{type}</h4>
        </div>

        <div className="bg-background border border-border-subtle rounded-lg p-3">
          <p className="text-sm text-primary">
            <strong>{details}</strong> — {schedule}
          </p>
        </div>

        <a
          href="/care-plan"
          className="text-sm text-accent flex items-center justify-center gap-1 hover:underline pt-1"
        >
          View Full Plan
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </a>
      </div>
    </div>
  )
}
