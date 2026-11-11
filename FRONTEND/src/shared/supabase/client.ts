import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export function syncAuthCookie(token?: string | null) {
  if (typeof document === 'undefined') return
  if (token) {
    const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
    document.cookie = `mediq-auth-token=${token}; path=/; max-age=604800; SameSite=Lax${isSecure ? '; Secure' : ''}`
  } else {
    document.cookie = 'mediq-auth-token=; path=/; max-age=0; SameSite=Lax'
  }
}

export function clearAuthCookie() {
  if (typeof document === 'undefined') return
  document.cookie = 'mediq-auth-token=; path=/; max-age=0; SameSite=Lax'
}

if (typeof window !== 'undefined') {
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        syncAuthCookie(session.access_token)
      } else if (_event === 'SIGNED_OUT') {
        clearAuthCookie()
      }
    })
  } catch (err) {
    console.warn('Supabase auth state change listener warning:', err)
  }
}
