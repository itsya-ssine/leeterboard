import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export function centralErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const reqId = req.id || crypto.randomUUID();
  const rawStatus = (err as Record<string, unknown> | null)?.status ?? (err as Record<string, unknown> | null)?.statusCode;
  const status = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

  if (res.headersSent) return;

  if (status >= 500) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        requestId: reqId,
        method: req.method,
        path: req.path,
        message
      })
    );
    res.status(500).json({
      error: "Something went wrong. Please try again.",
      requestId: reqId
    });
    return;
  }

  const clientMessage =
    status === 413
      ? "Payload too large."
      : status === 400
      ? "Invalid request payload."
      : "Bad request.";
  res.status(status).json({
    error: clientMessage,
    requestId: reqId
  });
}
