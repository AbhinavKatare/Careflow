import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { verifyAuditTrail } from "../audit-chain";
import { getSqlite } from "../db";
import { seedDatabase } from "../persistence";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import {
  inputSizeLimitMiddleware,
  rateLimiterMiddleware,
  strictSecurityHeadersMiddleware,
} from "../security/middleware";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Security Headers (Strict CSP, X-Frame-Options, HSTS, etc.)
  app.use(strictSecurityHeadersMiddleware);

  // Input Size Limits (128 KB max body)
  app.use(inputSizeLimitMiddleware(131072));
  app.use(express.json({ limit: "128kb" }));
  app.use(express.urlencoded({ limit: "128kb", extended: true }));

  // API Rate Limiting (Sliding Window: 120 requests/min per IP)
  app.use("/api", rateLimiterMiddleware({ windowMs: 60000, maxRequests: 120 }));

  // Auto-seed database if empty on server start
  try {
    const sqlite = getSqlite();
    seedDatabase(sqlite);
  } catch (err) {
    console.warn("[Database] Auto-seed error:", err);
  }

  // Health, Liveness, and Readiness endpoints
  app.get(["/health", "/api/health"], (_req, res) => res.json({ status: "ok" }));

  app.get(["/health/live", "/api/health/live", "/healthz"], (_req, res) => {
    res.status(200).json({ status: "ok", liveness: true, timestamp: Date.now() });
  });

  app.get(["/health/ready", "/api/health/ready", "/readyz"], (_req, res) => {
    try {
      const sqlite = getSqlite();
      sqlite.prepare("SELECT 1").get();
      const auditStatus = verifyAuditTrail(sqlite);

      if (!auditStatus.valid) {
        res.status(503).json({
          status: "degraded",
          readiness: false,
          db: "connected",
          auditTrailValid: false,
          error: auditStatus.reason,
        });
        return;
      }

      res.status(200).json({
        status: "ok",
        readiness: true,
        db: "connected",
        auditTrailValid: true,
        totalAuditEvents: auditStatus.totalEvents,
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      res.status(503).json({
        status: "error",
        readiness: false,
        db: "disconnected",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", (error) => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () =>
    console.log(`Careflow server listening on port ${port}`)
  );
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
