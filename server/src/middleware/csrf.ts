import { randomBytes, createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

// In production, this should come from environment variable
const CSRF_SECRET = process.env.CSRF_SECRET || 'csrf-secret-key-change-in-production';

function signToken(token: string): string {
  const hmac = createHmac('sha256', CSRF_SECRET);
  hmac.update(token);
  const signature = hmac.digest('base64url');
  return `${token}.${signature}`;
}

function verifyToken(signedToken: string): boolean {
  const lastDot = signedToken.lastIndexOf('.');
  if (lastDot === -1) return false;

  const token = signedToken.substring(0, lastDot);
  const signature = signedToken.substring(lastDot + 1);

  const hmac = createHmac('sha256', CSRF_SECRET);
  hmac.update(token);
  const expectedSignature = hmac.digest('base64url');

  return signature === expectedSignature;
}

export function generateCsrfToken(): string {
  const token = randomBytes(CSRF_TOKEN_LENGTH).toString('base64url');
  return signToken(token);
}

export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Safe methods don't need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  if (!cookieToken || !headerToken) {
    res.status(403).json({ error: 'CSRF token missing' });
    return;
  }

  // Tokens must match (double-submit pattern)
  if (cookieToken !== headerToken) {
    res.status(403).json({ error: 'CSRF token invalid' });
    return;
  }

  // Token must have valid signature (prevents forged tokens)
  if (!verifyToken(cookieToken)) {
    res.status(403).json({ error: 'CSRF token invalid' });
    return;
  }

  next();
}

export function setCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  next();
}
