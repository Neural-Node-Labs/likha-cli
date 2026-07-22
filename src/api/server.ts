import express from "express";
import cors from "cors";
import { createRouter } from "./routes.js";
// Auth is always enabled — no more static admin credentials

export interface ApiServerOptions {
  port?: number;
  host?: string;
}

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = "0.0.0.0";

/**
 * Start the xcoder HTTP API server.
 *
 * Returns the server instance so the caller can close it (e.g. for testing or graceful shutdown).
 */
export function startApiServer(opts: ApiServerOptions = {}): import("http").Server {
  const port = parseInt(process.env.XCODER_API_PORT ?? String(opts.port ?? DEFAULT_PORT), 10);
  const host = process.env.XCODER_API_HOST ?? opts.host ?? DEFAULT_HOST;

  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Routes
  const router = createRouter();
  app.use("/api/v1", router);

  // 404 catch-all
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[xcoder API] Unhandled error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  });

  const server = app.listen(port, host, () => {
    console.log(`[xcoder API] Listening on http://${host}:${port}`);
    console.log(`[xcoder API] Endpoints:`);
    console.log(`  POST /api/v1/login`);
    console.log(`  POST /api/v1/logout`);
    console.log(`  GET  /api/v1/health`);
    console.log(`  POST /api/v1/chat`);
    console.log(`  POST /api/v1/chat/plan`);
    console.log(`  POST /api/v1/chat/execute`);
    console.log(`  GET  /api/v1/telemetry?log=thinking&limit=50`);
    console.log(`  GET  /api/v1/skills`);
    console.log(`  GET  /api/v1/users`);
    console.log(`  POST /api/v1/users`);
    console.log(`  PUT  /api/v1/users/:id`);
    console.log(`  DELETE /api/v1/users/:id`);
    console.log(`  GET  /api/v1/plans`);
    console.log(`  POST /api/v1/plans`);
    console.log(`  GET  /api/v1/plans/:id`);
    console.log(`  PUT  /api/v1/plans/:id/status`);
    console.log(`  PUT  /api/v1/plans/:planId/tasks/:taskId`);
    console.log(`  POST /api/v1/plans/:id/tasks`);
    console.log(`  DELETE /api/v1/plans/:planId/tasks/:taskId`);
    console.log(`[xcoder API] Auth: Token-based authentication active. First user to register becomes admin.`);
  });

  return server;
}


