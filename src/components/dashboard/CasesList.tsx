type CaseItem = {
  id: string
  symptoms_description: string
  urgency: string
  status: string
  created_at: string
}

type CasesListProps = {
  cases: CaseItem[]
}

const statusStyles: Record<string, string> = {
  pending: 'bg-surface-secondary text-primary',
  in_review: 'bg-[#FFF4E5] text-[#B26B00]',
  responded: 'bg-[#E8F5E9] text-[#2E7D32]',
  closed: 'bg-gray-100 text-gray-500',
}

const urgencyDot: Record<string, string> = {
  routine: 'bg-gray-400',
  somewhat_urgent: 'bg-orange-500',
  needs_live_call: 'bg-red-600',
}

export default function CasesList({ cases }: CasesListProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center border-b border-border-subtle pb-2">
        <h3 className="text-lg font-semibold text-primary">Your Cases</h3>
        <span className="bg-surface-secondary px-2 py-1 rounded text-xs text-text-muted">
          {cases.length} Active
        </span>
      </div>

      {cases.length === 0 ? (
        <p className="text-sm text-text-muted">You haven't submitted any cases yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cases.map((c) => (
            <div
              key={c.id}
              className="bg-white border border-border-subtle rounded-lg p-4 hover:border-primary cursor-pointer transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-medium text-primary line-clamp-1">
                  {c.symptoms_description}
                </h4>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                    statusStyles[c.status] || statusStyles.pending
                  }`}
                >
                  {c.status.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${urgencyDot[c.urgency] || urgencyDot.routine}`} />
                <span className="text-xs text-text-muted capitalize">
                  {c.urgency.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Submitted {new Date(c.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
