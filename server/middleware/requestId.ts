import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId = (req.get("x-request-id") || crypto.randomUUID()).trim();
  req.id = reqId;
  res.setHeader("x-request-id", reqId);
  next();
}
