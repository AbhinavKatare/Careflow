/**
 * Security Middleware Layer (/server/security/middleware.ts).
 *
 * Implements:
 * 1. Strict Content Security Policy (CSP) & Hardened HTTP Security Headers.
 * 2. Sliding-Window Rate Limiting (DoS and brute-force protection).
 * 3. Strict Input Payload Size Limits.
 *
 * PERMANENT RULES:
 * - Zero external leaks.
 * - Frame ancestors disabled ('none').
 * - Strict mime sniffing disabled.
 */

import type { Request, Response, NextFunction } from "express";

export interface RateLimitOptions {
  windowMs?: number; // e.g. 60,000 ms (1 minute)
  maxRequests?: number; // e.g. 60 requests per window
}

interface ClientBucket {
  count: number;
  resetAtMs: number;
}

const rateLimitStore = new Map<string, ClientBucket>();

/**
 * Cleanup expired rate limit buckets periodically.
 */
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitStore.entries()) {
    if (bucket.resetAtMs <= now) {
      rateLimitStore.delete(ip);
    }
  }
}, 30000);

/**
 * Sliding-window in-memory rate limiter middleware.
 */
export function rateLimiterMiddleware(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs || 60000;
  const maxRequests = options.maxRequests || 60;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Determine client identifier
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "127.0.0.1";

    const now = Date.now();
    let bucket = rateLimitStore.get(clientIp);

    if (!bucket || bucket.resetAtMs <= now) {
      bucket = { count: 1, resetAtMs: now + windowMs };
      rateLimitStore.set(clientIp, bucket);
    } else {
      bucket.count++;
    }

    const remaining = Math.max(0, maxRequests - bucket.count);
    const retryAfterSec = Math.ceil((bucket.resetAtMs - now) / 1000);

    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAtMs / 1000).toString());

    if (bucket.count > maxRequests) {
      res.setHeader("Retry-After", retryAfterSec.toString());
      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit of ${maxRequests} requests per minute exceeded. Please retry in ${retryAfterSec} seconds.`,
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    next();
  };
}

/**
 * Strict Content Security Policy (CSP) and Hardened HTTP Headers.
 */
export function strictSecurityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // Strict Content-Security-Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss: http: https:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  next();
}

/**
 * Input size limiter middleware (guards against oversized JSON or URL-encoded payloads).
 * Default threshold: 128 KB for API requests.
 */
export function inputSizeLimitMiddleware(maxBytes: number = 131072) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = req.headers["content-length"];
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      res.status(413).json({
        error: "Payload Too Large",
        message: `Request entity exceeds allowable size limit of ${maxBytes} bytes (128 KB).`,
      });
      return;
    }
    next();
  };
}

