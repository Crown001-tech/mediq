'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

export default function BottomNav() {
  const pathname = usePathname()
  const [hasCarePlanUnread, setHasCarePlanUnread] = useState(false)

  useEffect(() => {
    const checkCarePlanUnread = () => {
      try {
        setHasCarePlanUnread(localStorage.getItem('mediq_care_plan_has_unread') === 'true')
      } catch { }
    }
    checkCarePlanUnread()

    window.addEventListener('mediq_care_plan_updated', checkCarePlanUnread)
    window.addEventListener('mediq_care_plan_viewed', checkCarePlanUnread)
    return () => {
      window.removeEventListener('mediq_care_plan_updated', checkCarePlanUnread)
      window.removeEventListener('mediq_care_plan_viewed', checkCarePlanUnread)
    }
  }, [])

  const navItems = [
    { label: 'Dashboard', icon: 'dashboard', href: '/dashboard' },
    { label: 'Cases', icon: 'folder_shared', href: '/cases' },
    { label: 'Messages', icon: 'chat', href: '/messages' },
    { label: 'Care Plan', icon: 'assignment', href: '/care-plan' },
    { label: 'Profile', icon: 'person', href: '/profile' },
  ]

  return (
    <nav className="md:hidden bg-white fixed bottom-0 w-full z-50 border-t border-border-subtle flex justify-around items-center px-1 py-2 pb-[max(env(safe-area-inset-bottom),10px)]">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== '/dashboard' && pathname?.startsWith(item.href))
        const showDot = item.label === 'Care Plan' && hasCarePlanUnread

        return (
          <Link
            key={item.label}
            href={item.href}
            className={`relative flex flex-col items-center justify-center flex-1 py-1 px-0.5 rounded-lg transition-colors ${
              isActive ? 'text-accent font-bold' : 'text-text-muted hover:text-primary'
            }`}
          >
            <div className="relative">
              <span className="material-symbols-outlined text-[22px] mb-0.5">{item.icon}</span>
              {showDot && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white animate-pulse" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
