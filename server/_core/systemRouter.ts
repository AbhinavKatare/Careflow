import { z } from "zod";
import { verifyAuditTrail } from "../audit-chain";
import { getSqlite } from "../db";
import { resetDemoDataInDb } from "../persistence";
import { publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z
        .object({
          timestamp: z.number().min(0, "timestamp cannot be negative").optional(),
        })
        .optional()
    )
    .query(() => ({
      ok: true,
      timestamp: Date.now(),
    })),

  liveness: publicProcedure.query(() => ({
    status: "ok",
    liveness: true,
    timestamp: Date.now(),
  })),

  readiness: publicProcedure.query(() => {
    try {
      const sqlite = getSqlite();
      // Test database connectivity
      sqlite.prepare("SELECT 1").get();
      const auditStatus = verifyAuditTrail(sqlite);

      return {
        status: "ok",
        readiness: true,
        db: "connected",
        auditTrailValid: auditStatus.valid,
        totalAuditEvents: auditStatus.totalEvents,
        timestamp: Date.now(),
      };
    } catch (err: unknown) {
      return {
        status: "error",
        readiness: false,
        db: "disconnected",
        auditTrailValid: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }),

  resetDemoData: publicProcedure
    .input(
      z.object({
        confirmed: z.boolean(),
      })
    )
    .mutation(({ input }) => {
      if (!input.confirmed) {
        throw new Error("Explicit confirmation is required to reset demo data.");
      }
      const sqlite = getSqlite();
      return resetDemoDataInDb(sqlite, { confirmed: input.confirmed, isLocal: true });
    }),
});
