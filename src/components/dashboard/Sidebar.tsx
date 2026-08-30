import Link from 'next/link'

type SidebarProps = {
  fullName: string
  email: string
  activePage?: string
}

export default function Sidebar({ fullName, email, activePage = 'Dashboard' }: SidebarProps) {
  const navItems = [
    { label: 'Dashboard', icon: 'home', href: '/dashboard' },
    { label: 'My Cases', icon: 'folder_shared', href: '/cases' },
    { label: 'Care Plan', icon: 'assignment', href: '/care-plan' },
    { label: 'Case History', icon: 'history', href: '/history' },
    { label: 'Profile', icon: 'settings', href: '/profile' },
  ]

  return (
    <aside className="hidden md:flex bg-white h-screen w-64 fixed left-0 top-0 border-r border-border-subtle flex-col py-2 px-2 gap-2 z-40">
      <div className="px-4 py-6">
        <h1 className="text-xl font-bold text-primary">MEDIQ</h1>
        <p className="text-xs text-text-muted mt-1">Patient Portal</p>
      </div>

      <nav className="flex-1 px-2 space-y-1 mt-4">
        {navItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
              item.label === activePage
                ? 'bg-accent text-white'
                : 'text-text-muted hover:bg-surface-secondary'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto p-4">
        <button className="w-full bg-accent text-white text-sm font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity">
          Book Consultation
        </button>
        <div className="mt-4 flex items-center gap-3 pt-4 border-t border-border-subtle">
          <div className="w-10 h-10 rounded-full bg-surface-secondary flex items-center justify-center text-primary font-semibold">
            {fullName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-primary">{fullName}</p>
            <p className="text-xs text-text-muted">{email}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}