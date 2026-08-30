export default function DesktopHeader() {
  return (
    <header className="hidden md:flex sticky top-0 z-30 bg-white border-b border-border-subtle justify-end items-center h-16 px-8">
      <div className="flex items-center gap-4">
        <button className="text-text-muted hover:bg-surface-secondary rounded-full p-2 transition-colors">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <div className="w-8 h-8 rounded-full bg-surface-secondary flex items-center justify-center text-primary text-sm font-semibold">
          <span className="material-symbols-outlined text-[18px]">person</span>
        </div>
      </div>
    </header>
  )
}