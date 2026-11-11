import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://goqcmqxfkailyijdmvnd.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

let cachedAdmin: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('supabaseAdmin is server-only and cannot be evaluated in the browser.')
  }
  if (!cachedAdmin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseServiceKey
    if (!key) {
      console.warn('SUPABASE_SERVICE_ROLE_KEY is not defined in server environment.')
    }
    cachedAdmin = createClient(supabaseUrl.trim(), key.trim() || 'missing-service-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return cachedAdmin
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin()
    const value = (client as any)[prop]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
