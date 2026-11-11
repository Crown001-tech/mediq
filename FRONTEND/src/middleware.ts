import { NextRequest, NextResponse } from 'next/server'

interface JwtPayload {
  sub?: string
  exp?: number
  email?: string
  [key: string]: any
}

function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    // Replace URL-safe characters and add padding if necessary
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(base64)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // 1. Extract session token from cookie or Authorization header
  let token = request.cookies.get('mediq-auth-token')?.value
  const authHeader = request.headers.get('authorization')
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim()
  }

  const isApiRoute = pathname.startsWith('/api/')
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')
  const isDoctorRoute = pathname === '/doctor' || pathname.startsWith('/doctor/')

  // Helper for unauthenticated response
  const handleUnauthenticated = () => {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete('mediq-auth-token')
    return response
  }

  if (!token) {
    return handleUnauthenticated()
  }

  // 2. Validate token format and expiration
  const payload = parseJwtPayload(token)
  if (!payload || !payload.sub) {
    return handleUnauthenticated()
  }

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return handleUnauthenticated()
  }

  // 3. Fetch user profile from Supabase to verify role and status
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    // If environment is misconfigured, allow through or handle gracefully
    return NextResponse.next()
  }

  try {
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${payload.sub}&select=role,verified`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: 'no-store',
      }
    )

    if (!profileRes.ok) {
      // In case of database error, fail closed on admin and doctor routes
      if (isAdminRoute || isDoctorRoute) {
        return handleUnauthenticated()
      }
      return NextResponse.next()
    }

    const profiles = await profileRes.json()
    const profile = Array.isArray(profiles) ? profiles[0] : null

    if (!profile) {
      return handleUnauthenticated()
    }

    // 4. Strict Role & Verification Enforcement
    if (isAdminRoute) {
      if (profile.role !== 'admin') {
        if (isApiRoute) {
          return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
        }
        const redirectUrl = new URL('/dashboard', request.url)
        return NextResponse.redirect(redirectUrl)
      }
      return NextResponse.next()
    }

    if (isDoctorRoute) {
      if (profile.role !== 'doctor') {
        const redirectUrl = new URL('/dashboard', request.url)
        return NextResponse.redirect(redirectUrl)
      }

      if (!profile.verified) {
        const loginUrl = new URL('/login', request.url)
        loginUrl.searchParams.set('error', 'pending_verification')
        const response = NextResponse.redirect(loginUrl)
        response.cookies.delete('mediq-auth-token')
        return response
      }

      return NextResponse.next()
    }

    // Patient protected routes
    if (profile.role === 'rejected') {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('error', 'rejected')
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('mediq-auth-token')
      return response
    }

    if (profile.role === 'doctor' && profile.verified && pathname === '/dashboard') {
      return NextResponse.redirect(new URL('/doctor/dashboard', request.url))
    }

    return NextResponse.next()
  } catch (err) {
    console.error('Middleware auth check error:', err)
    if (isAdminRoute || isDoctorRoute) {
      return handleUnauthenticated()
    }
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    '/admin',
    '/admin/:path*',
    '/doctor',
    '/doctor/:path*',
    '/dashboard',
    '/submit-case',
    '/cases/:path*',
    '/messages',
    '/care-plan',
    '/log-dose',
    '/check-in',
    '/appointments',
    '/history',
    '/profile',
  ],
}
