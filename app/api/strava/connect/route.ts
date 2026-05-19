import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { getAuthUrl } from '@/lib/strava'

export const GET = requireAuth(async (_req: NextRequest, userId: string) => {
  // Use userId as OAuth state for CSRF protection + user identification in callback
  const authUrl = getAuthUrl(userId)
  return NextResponse.json({ authUrl })
})
