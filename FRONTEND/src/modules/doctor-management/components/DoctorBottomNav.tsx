import Link from 'next/link'
import { DoctorBottomNavProps } from '../types'

export default function DoctorBottomNav({ activePage = 'Dashboard' }: DoctorBottomNavProps) {
  const isQueue = activePage === 'Queue' || activePage === 'Case Queue' || activePage === 'Triage Queue'
  const isAppointments = activePage === 'Appointments' || activePage === 'Telehealth' || activePage === 'Consultations'
  const isMessages = activePage === 'Messages' || activePage === 'Follow-Up Messages' || activePage === 'Chat'
  const isDashboard = activePage === 'Dashboard'
  const isPatients = activePage === 'Patients' || activePage === 'My Patients'

  const navItems = [
    { label: 'Dashboard', icon: 'dashboard', href: '/doctor/dashboard', active: isDashboard },
    { label: 'Queue', icon: 'pending_actions', href: '/doctor/queue', active: isQueue },
    { label: 'Telehealth', icon: 'videocam', href: '/doctor/appointments', active: isAppointments },
    { label: 'Messages', icon: 'chat', href: '/doctor/messages', active: isMessages },
    { label: 'Patients', icon: 'group', href: '/doctor/patients', active: isPatients },
  ]

  return (
    <nav className="md:hidden bg-white fixed bottom-0 w-full z-50 border-t border-border-subtle flex justify-around items-center px-1 py-2 pb-[max(env(safe-area-inset-bottom),10px)]">
      {navItems.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-0.5 rounded-lg transition-colors ${
            item.active ? 'text-accent font-bold' : 'text-text-muted hover:text-primary'
          }`}
        >
          <span className="material-symbols-outlined text-[22px] mb-0.5">{item.icon}</span>
          <span className="text-[10px] tracking-tight">{item.label}</span>
        </Link>
      ))}
    </nav>
  )
}
