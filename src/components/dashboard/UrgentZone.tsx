type UrgentZoneProps = {
  hospitalAlert?: string | null
  doseReminder?: string | null
}

export default function UrgentZone({ hospitalAlert, doseReminder }: UrgentZoneProps) {
  if (!hospitalAlert && !doseReminder) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      {hospitalAlert && (
        <div className="bg-white border-2 border-red-600 rounded-lg p-4 md:p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-red-100 text-red-700 p-2 rounded-full flex-shrink-0">
              <span className="material-symbols-outlined text-[20px]">warning</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-red-600 mb-1">Action Required</h3>
              <p className="text-sm text-primary">{hospitalAlert}</p>
            </div>
          </div>
          <button className="w-full bg-white border border-primary text-primary text-sm font-medium py-2.5 rounded-lg hover:bg-surface-secondary transition-colors">
            View Details
          </button>
        </div>
      )}

      {doseReminder && (
        <div className="bg-white border-2 border-accent rounded-lg p-4 md:p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-surface-secondary text-accent p-2 rounded-full flex-shrink-0">
              <span className="material-symbols-outlined text-[20px]">medication</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-accent mb-1">Upcoming Medication</h3>
              <p className="text-sm text-primary">{doseReminder}</p>
            </div>
          </div>
          <button className="w-full bg-accent text-white text-sm font-medium py-2.5 rounded-lg hover:opacity-90 transition-colors">
            Log Now
          </button>
        </div>
      )}
    </div>
  )
}
