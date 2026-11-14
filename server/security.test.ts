/**
 * Security & Hardening Test Suite (/server/security.test.ts).
 *
 * Verifies:
 * 1. Strict CSP & security headers (X-Frame-Options: DENY, nosniff, strict CSP).
 * 2. In-memory sliding-window rate limiting (HTTP 429 when threshold exceeded).
 * 3. Input payload size limits (HTTP 413 when exceeding 128 KB).
 * 4. Secrets scan: asserts zero API keys, private keys, or tokens in codebase.
 * 5. Privacy guardrail: asserts NO patient free text or PHI ever appears in logs or traces.
 */

import { describe, expect, it } from "vitest";
import {
  inputSizeLimitMiddleware,
  rateLimiterMiddleware,
  strictSecurityHeadersMiddleware,
} from "./security/middleware";
import { runSecretsScan } from "../scripts/secrets-scan";
import { runCheckInPipeline } from "./pipeline/runner";
import { defaultWorkflowSpec } from "../shared/policy/default-spec";
import type { Request, Response } from "express";

function createMockExpressContext(headers: Record<string, string> = {}) {
  const req = {
    headers: { ...headers },
    socket: { remoteAddress: headers["x-test-ip"] || "127.0.0.1" },
  } as unknown as Request;

  const setHeaders: Record<string, string> = {};
  let statusCode = 200;
  let jsonBody: any = null;

  const res = {
    setHeader: (name: string, value: string) => {
      setHeaders[name.toLowerCase()] = value;
      return res;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: any) => {
      jsonBody = body;
      return res;
    },
  } as unknown as Response;

  return { req, res, getHeaders: () => setHeaders, getStatus: () => statusCode, getJson: () => jsonBody };
}

describe("Security Basics & Hardening (/server/security.test.ts)", () => {
  describe("1. Strict Content Security Policy & Security Headers", () => {
    it("sets hardened CSP and defensive security headers on all responses", () => {
      const { req, res, getHeaders } = createMockExpressContext();
      let nextCalled = false;

      strictSecurityHeadersMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      const headers = getHeaders();

      // Content-Security-Policy checks
      expect(headers["content-security-policy"]).toBeDefined();
      expect(headers["content-security-policy"]).toContain("default-src 'self'");
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["content-security-policy"]).toContain("object-src 'none'");

      // Additional defensive headers
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["strict-transport-security"]).toContain("max-age=31536000");
      expect(headers["permissions-policy"]).toContain("camera=()");
    });
  });

  describe("2. Rate Limiting Middleware", () => {
    it("allows requests under the rate limit threshold", () => {
      const limiter = rateLimiterMiddleware({ windowMs: 60000, maxRequests: 5 });
      const { req, res, getHeaders, getStatus } = createMockExpressContext({ "x-test-ip": "10.0.0.1" });
      let nextCalled = false;

      limiter(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(getStatus()).toBe(200);
      expect(getHeaders()["x-ratelimit-remaining"]).toBe("4");
    });

    it("intercepts and returns HTTP 429 when client exceeds request limit", () => {
      const limiter = rateLimiterMiddleware({ windowMs: 60000, maxRequests: 3 });
      const testIp = `192.168.1.${Math.floor(Math.random() * 200) + 10}`;

      // Exhaust limit
      for (let i = 0; i < 3; i++) {
        const ctx = createMockExpressContext({ "x-test-ip": testIp });
        limiter(ctx.req, ctx.res, () => {});
      }

      // 4th request must be rate-limited
      const blockedCtx = createMockExpressContext({ "x-test-ip": testIp });
      let nextCalled = false;
      limiter(blockedCtx.req, blockedCtx.res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(blockedCtx.getStatus()).toBe(429);
      expect(blockedCtx.getHeaders()["retry-after"]).toBeDefined();
      expect(blockedCtx.getJson().error).toBe("Too Many Requests");
    });
  });

  describe("3. Input Payload Size Limits", () => {
    it("allows payloads within the 128 KB size limit", () => {
      const sizeLimiter = inputSizeLimitMiddleware(131072);
      const { req, res, getStatus } = createMockExpressContext({ "content-length": "2048" }); // 2 KB
      let nextCalled = false;

      sizeLimiter(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(getStatus()).toBe(200);
    });

    it("rejects oversized payloads with HTTP 413 Payload Too Large", () => {
      const sizeLimiter = inputSizeLimitMiddleware(131072);
      const { req, res, getStatus, getJson } = createMockExpressContext({ "content-length": "200000" }); // ~200 KB
      let nextCalled = false;

      sizeLimiter(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(getStatus()).toBe(413);
      expect(getJson().error).toBe("Payload Too Large");
    });
  });

  describe("4. Secrets & Credentials Scan", () => {
    it("verifies zero hardcoded private keys, API secrets, or credentials exist in codebase", () => {
      const isClean = runSecretsScan();
      expect(isClean).toBe(true);
    });
  });

  describe("5. Privacy Guardrail: No Sensitive Data in Traces or Logs", () => {
    it("proves that patient raw free text and names NEVER appear in trace spans or attributes", async () => {
      const sensitivePatientNote = "MY_HIGHLY_CONFIDENTIAL_SYMPTOM_TEXT_99812";
      const sensitivePatientName = "CONFIDENTIAL_PATIENT_DOE_123";

      const result = await runCheckInPipeline(
        {
          patientId: "DEMO-PRIVACY-001",
          patientName: sensitivePatientName,
          weekStatus: "Having difficulty or symptoms",
          note: sensitivePatientNote,
        },
        { spec: defaultWorkflowSpec }
      );

      // Verify trace does not contain raw patient note or name
      const traceJson = JSON.stringify(result.trace);
      expect(traceJson).not.toContain(sensitivePatientNote);
      expect(traceJson).not.toContain(sensitivePatientName);

      // Check all span attributes individually
      for (const span of result.trace.spans) {
        for (const [attrKey, attrVal] of Object.entries(span.attributes)) {
          expect(String(attrVal)).not.toContain(sensitivePatientNote);
          expect(String(attrVal)).not.toContain(sensitivePatientName);
          expect(attrKey).not.toContain("patient_text");
        }
      }
    });
  });
});

