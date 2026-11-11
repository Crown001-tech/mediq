'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { DoctorSidebarProps } from '../types'

function getInitials(name: string): string {
  const clean = name.replace(/^Dr\.\s*/i, '').trim()
  if (!clean) return 'DR'
  const parts = clean.split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function DoctorSidebar({ fullName, specialty, activePage = 'Dashboard' }: DoctorSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('mediq_doctor_sidebar_collapsed') === 'true'
    setCollapsed(stored)
    document.documentElement.style.setProperty('--doctor-sidebar-width', stored ? '5rem' : '16rem')
  }, [])

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('mediq_doctor_sidebar_collapsed', String(next))
    document.documentElement.style.setProperty('--doctor-sidebar-width', next ? '5rem' : '16rem')
    window.dispatchEvent(new CustomEvent('mediq_doctor_sidebar_toggle', { detail: { collapsed: next } }))
  }

  const navItems = [
    { label: 'Dashboard', icon: 'dashboard', href: '/doctor/dashboard' },
    { label: 'Case Queue', icon: 'pending_actions', href: '/doctor/queue' },
    { label: 'Appointments', icon: 'videocam', href: '/doctor/appointments' },
    { label: 'Messages', icon: 'chat', href: '/doctor/messages' },
    { label: 'My Patients', icon: 'group', href: '/doctor/patients' },
    { label: 'Profile', icon: 'person', href: '/doctor/profile' },
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
            <Link
              href="/doctor/dashboard"
              className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center font-black text-base shadow-xs"
              title="MEDIQ Doctor Suite"
            >
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
                  Physician Suite
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
              (item.label === 'Appointments' &&
                (activePage === 'Appointments' ||
                  activePage === 'Telehealth' ||
                  activePage === 'Consultations')) ||
              (item.label === 'Case Queue' &&
                (activePage === 'Queue' ||
                  activePage === 'Case Queue' ||
                  activePage === 'Triage Queue' ||
                  activePage === 'Follow-Up Notes')) ||
              (item.label === 'Messages' &&
                (activePage === 'Messages' ||
                  activePage === 'Follow-Up Messages' ||
                  activePage === 'Chat'))

            return (
              <Link
                key={item.label}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all ${
                  collapsed ? 'justify-center' : ''
                } ${
                  isActive
                    ? 'bg-accent text-white font-bold shadow-2xs'
                    : 'text-text-muted hover:text-primary hover:bg-surface-secondary'
                }`}
              >
                <span className="material-symbols-outlined text-[20px] shrink-0">
                  {item.icon}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* ── Bottom Section & Retract Trigger (Collapsed) ───── */}
      <div className="p-3 border-t border-border-subtle flex flex-col gap-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 pt-1">
            <Link
              href="/doctor/profile"
              className="w-10 h-10 rounded-xl bg-surface-secondary border border-border-subtle text-primary hover:border-accent hover:text-accent flex items-center justify-center font-bold text-xs shadow-2xs transition-all"
              title={`${fullName || 'Doctor'} (${specialty || 'Physician'})`}
            >
              {initials}
            </Link>

            <button
              type="button"
              onClick={toggleCollapse}
              className="w-7 h-7 rounded-lg text-text-muted hover:text-primary hover:bg-surface-secondary flex items-center justify-center transition-colors cursor-pointer mt-1"
              title="Expand sidebar"
            >
              <span className="material-symbols-outlined text-[18px]">
                last_page
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-surface-secondary transition-colors">
            <Link href="/doctor/profile" className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-xl bg-surface-secondary border border-border-subtle text-primary font-bold text-xs flex items-center justify-center shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-primary truncate leading-tight">
                  {fullName || 'Attending Physician'}
                </p>
                <p className="text-[10px] text-text-muted truncate mt-0.5">
                  {specialty || 'Clinical Staff'}
                </p>
              </div>
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}
