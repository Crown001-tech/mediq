import { NotificationBell } from '@/modules/notifications'

export default function TopBar() {
  return (
    <header className="md:hidden bg-white w-full sticky top-0 z-50 border-b border-border-subtle flex justify-between items-center px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-accent">medical_services</span>
        <span className="text-lg font-bold text-primary">MEDIQ</span>
      </div>

      <div className="flex items-center gap-4">
        <NotificationBell />
      </div>
    </header>
  )
}
