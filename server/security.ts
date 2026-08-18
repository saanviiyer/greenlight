import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
}

export function rateLimit(windowMs: number, max: number) {
  const clients = new Map<string, { startedAt: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now(); const key = req.ip || req.socket.remoteAddress || 'unknown';
    const old = clients.get(key);
    const current = !old || now - old.startedAt >= windowMs ? { startedAt: now, count: 1 } : { ...old, count: old.count + 1 };
    clients.set(key, current);
    res.set('RateLimit-Limit', String(max)); res.set('RateLimit-Remaining', String(Math.max(0, max - current.count)));
    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - current.startedAt)) / 1_000)));
      res.status(429).json({ error: 'Too many requests. Please try again later.' }); return;
    }
    next();
  };
}
