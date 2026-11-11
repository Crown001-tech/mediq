'use client'

import { useRouter } from 'next/navigation'

export default function QuickActions() {
  const router = useRouter()

  const actions = [
    { label: 'Submit a Case', icon: 'add_circle', href: '/submit-case' },
    { label: 'Log a Dose', icon: 'vaccines', href: '/log-dose' },
    { label: 'Check In', icon: 'event_available', href: '/check-in' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => router.push(action.href)}
          className="bg-white border border-border-subtle rounded-lg p-4 flex flex-col md:flex-row items-center justify-center gap-2 md:gap-3 hover:border-primary transition-colors md:h-16 cursor-pointer"
        >
          <span className="material-symbols-outlined text-accent text-[24px] md:text-[20px]">
            {action.icon}
          </span>
          <span className="text-sm font-medium text-primary text-center">{action.label}</span>
        </button>
      ))}
    </div>
  )
}
