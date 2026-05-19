import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, getTokenFromHeader } from './auth'

export function requireAuth(handler: (req: NextRequest, userId: string) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const token = getTokenFromHeader(req.headers.get('Authorization'))
    if (!token) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }
    try {
      const payload = verifyToken(token)
      return handler(req, payload.userId)
    } catch {
      return NextResponse.json({ error: 'Token ungültig oder abgelaufen' }, { status: 401 })
    }
  }
}
