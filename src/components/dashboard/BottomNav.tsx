import Link from 'next/link'

export default function BottomNav() {
  const navItems = [
    { label: 'Dashboard', icon: 'dashboard', href: '/dashboard', active: true },
    { label: 'Cases', icon: 'folder_shared', href: '/cases', active: false },
    { label: 'Care Plan', icon: 'assignment', href: '/care-plan', active: false },
    { label: 'Profile', icon: 'person', href: '/profile', active: false },
  ]

  return (
    <nav className="md:hidden bg-white fixed bottom-0 w-full z-50 border-t border-border-subtle flex justify-around items-center px-2 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
      {navItems.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={`flex flex-col items-center justify-center w-1/4 p-1 rounded-lg transition-colors ${
            item.active ? 'text-accent font-semibold' : 'text-text-muted'
          }`}
        >
          <span className="material-symbols-outlined text-[24px] mb-1">{item.icon}</span>
          <span className="text-xs">{item.label}</span>
        </Link>
      ))}
    </nav>
  )
}
