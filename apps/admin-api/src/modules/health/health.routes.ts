// ADM-NFR-06 · GET /health (spec M0 §3.1).
import { HealthResponseSchema } from "@ai/contracts";
import { Hono } from "hono";

export function healthRoutes(cfg: { version: string }): Hono {
  const r = new Hono();
  // `.parse` (không safeParse): version sai định dạng phải thành 500, không trả body sai contract.
  r.get("/", (c) => c.json(HealthResponseSchema.parse({ status: "ok", version: cfg.version })));
  return r;
}
