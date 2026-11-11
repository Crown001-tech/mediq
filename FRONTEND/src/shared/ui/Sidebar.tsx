'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export type SidebarProps = {
  fullName: string
  email: string
  activePage?: string
}

function getInitials(name: string): string {
  if (!name.trim()) return 'PT'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Sidebar({ fullName, email, activePage = 'Dashboard' }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [hasCarePlanUnread, setHasCarePlanUnread] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('mediq_sidebar_collapsed') === 'true'
    setCollapsed(stored)
    document.documentElement.style.setProperty('--sidebar-width', stored ? '5rem' : '16rem')

    const checkCarePlanUnread = () => {
      try {
        setHasCarePlanUnread(localStorage.getItem('mediq_care_plan_has_unread') === 'true')
      } catch {}
    }
    checkCarePlanUnread()

    window.addEventListener('mediq_care_plan_updated', checkCarePlanUnread)
    window.addEventListener('mediq_care_plan_viewed', checkCarePlanUnread)
    return () => {
      window.removeEventListener('mediq_care_plan_updated', checkCarePlanUnread)
      window.removeEventListener('mediq_care_plan_viewed', checkCarePlanUnread)
    }
  }, [])

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('mediq_sidebar_collapsed', String(next))
    document.documentElement.style.setProperty('--sidebar-width', next ? '5rem' : '16rem')
    window.dispatchEvent(new CustomEvent('mediq_sidebar_toggle', { detail: { collapsed: next } }))
  }

  const navItems = [
    { label: 'Dashboard', icon: 'dashboard', href: '/dashboard' },
    { label: 'My Cases', icon: 'folder_shared', href: '/cases' },
    { label: 'Messages', icon: 'chat', href: '/messages' },
    { label: 'Care Plan', icon: 'assignment', href: '/care-plan' },
    { label: 'Appointments', icon: 'calendar_month', href: '/appointments' },
    { label: 'Case History', icon: 'history', href: '/history' },
    { label: 'Profile', icon: 'account_circle', href: '/profile' },
  ]

  const initials = getInitials(fullName)

  return (
    <aside
      className={`hidden md:flex bg-white h-screen fixed left-0 top-0 border-r border-border-subtle flex-col justify-between z-40 transition-all duration-300 ease-in-out ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* ── Top Header Brand ───────────────────────────────── */}
      <div className="flex flex-col">
        <div
          className={`h-16 flex items-center border-b border-border-subtle px-4 ${
            collapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          {collapsed ? (
            <Link href="/dashboard" className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center font-black text-base shadow-xs" title="MEDIQ">
              M
            </Link>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center font-black text-base shadow-xs">
                M
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-primary block leading-none">
                  MEDIQ
                </span>
                <span className="text-[10px] uppercase font-bold tracking-widest text-accent mt-0.5 block">
                  Patient Hub
                </span>
              </div>
            </div>
          )}

          {/* Retract Toggle (Desktop) */}
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              className="w-7 h-7 rounded-lg text-text-muted hover:text-primary hover:bg-surface-secondary flex items-center justify-center transition-colors cursor-pointer"
              title="Retract sidebar"
            >
              <span className="material-symbols-outlined text-[18px]">
                first_page
              </span>
            </button>
          )}
        </div>

        {/* ── Navigation Items ───────────────────────────────── */}
        <nav className="p-3 space-y-1.5 mt-2">
          {navItems.map((item) => {
            const isActive =
              item.label === activePage ||
              (item.label === 'My Cases' && (activePage === 'Cases' || activePage === 'My Cases')) ||
              (item.label === 'Messages' && (activePage === 'Messages' || activePage === 'Chat')) ||
              (item.label === 'Appointments' && activePage === 'Appointments') ||
              (item.label === 'Case History' && (activePage === 'Case History' || activePage === 'History'))
            const showCarePlanDot = item.label === 'Care Plan' && hasCarePlanUnread

            return (
              <Link
                key={item.label}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all ${
                  collapsed ? 'justify-center' : ''
                } ${
                  isActive
                    ? 'bg-accent text-white font-bold shadow-2xs'
                    : 'text-text-muted hover:text-primary hover:bg-surface-secondary'
                }`}
              >
                <div className="relative shrink-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">
                    {item.icon}
                  </span>
                  {showCarePlanDot && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white animate-pulse" />
                  )}
                </div>
                {!collapsed && (
                  <div className="flex items-center justify-between flex-1 min-w-0">
                    <span className="truncate">{item.label}</span>
                    {showCarePlanDot && (
                      <span className="text-[10px] bg-emerald-500 text-white font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider animate-pulse shrink-0">
                        New
                      </span>
                    )}
                  </div>
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* ── Bottom Section & Retract Trigger (Collapsed) ───── */}
      <div className="p-3 border-t border-border-subtle flex flex-col gap-3">
        {/* Quick Action Button */}
        {collapsed ? (
          <Link
            href="/appointments?book=true"
            className="w-10 h-10 mx-auto rounded-xl bg-accent hover:bg-[#0c704d] text-white flex items-center justify-center shadow-xs transition-all cursor-pointer"
            title="Book Doctor Consultation"
          >
            <span className="material-symbols-outlined text-[20px]">videocam</span>
          </Link>
        ) : (
          <Link
            href="/appointments?book=true"
            className="w-full py-2.5 px-3 bg-accent hover:bg-[#0c704d] text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            <span>Book Consultation</span>
          </Link>
        )}

        {/* Profile Card / Monogram */}
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 pt-1">
            <Link
              href="/profile"
              className="w-10 h-10 rounded-xl bg-surface-secondary border border-border-subtle text-primary hover:border-accent hover:text-accent flex items-center justify-center font-bold text-xs shadow-2xs transition-all"
              title={`${fullName || 'Profile'} (${email})`}
            >
              {initials}
            </Link>

            {/* Expand Toggle Button */}
            <button
              type="button"
              onClick={toggleCollapse}
              className="w-8 h-8 rounded-lg text-text-muted hover:text-primary hover:bg-surface-secondary flex items-center justify-center transition-colors cursor-pointer mt-1"
              title="Expand sidebar"
            >
              <span className="material-symbols-outlined text-[18px]">
                last_page
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2.5 pt-1">
            <Link
              href="/profile"
              className="flex items-center gap-2.5 min-w-0 group cursor-pointer flex-1"
              title="View Account Settings"
            >
              <div className="w-9 h-9 rounded-xl bg-surface-secondary border border-border-subtle text-primary font-bold text-xs flex items-center justify-center shrink-0 group-hover:border-accent group-hover:text-accent transition-colors shadow-2xs">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-primary truncate group-hover:text-accent transition-colors">
                  {fullName || 'Patient Account'}
                </p>
                <p className="text-[10px] text-text-muted truncate">
                  {email}
                </p>
              </div>
            </Link>

            <Link
              href="/profile"
              className="w-7 h-7 rounded-lg text-text-muted hover:text-primary hover:bg-surface-secondary flex items-center justify-center transition-colors"
              title="Settings"
            >
              <span className="material-symbols-outlined text-[16px]">settings</span>
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}
