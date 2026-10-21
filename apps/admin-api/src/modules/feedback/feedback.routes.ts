// feedback · `/auth/feedback*` (mọi user đăng nhập; mọi web proxy `/auth` tới admin-api) và `/admin/feedback*` (tenant_admin + platform_admin).
import {
  FeedbackCreateRequestSchema,
  FeedbackListQuerySchema,
  FeedbackUpdateRequestSchema,
} from "@ai/contracts";
import { Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import {
  createFeedback,
  type FeedbackCtx,
  getFile,
  listAdmin,
  listMine,
  updateFeedback,
} from "./feedback.service";

type Deps = AuthDeps & FeedbackCtx;

const INLINE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function fileRoute(r: Hono<AppVars>, d: Deps): void {
  r.get("/:id/files/:fileId", async (c) => {
    const f = await getFile(d, c.get("actor"), parseIdParam(c), parseIdParam(c, "fileId"));
    // Không tin nội dung: ảnh hiện inline, còn lại luôn tải xuống; chặn sniff.
    const inline = INLINE_MIMES.has(f.mime);
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  });
}

export function feedbackUserRoutes(d: Deps): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d));
  r.get("/", async (c) => c.json(await listMine(d, c.get("actor"))));
  r.post("/", async (c) =>
    c.json(
      await createFeedback(d, c.get("actor"), await parseJson(c, FeedbackCreateRequestSchema)),
      201,
    ),
  );
  fileRoute(r, d);
  return r;
}

export function feedbackAdminRoutes(d: Deps): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d), requireRole("tenant_admin", "platform_admin"));
  r.get("/", async (c) =>
    c.json(await listAdmin(d, c.get("actor"), parseQuery(c, FeedbackListQuerySchema))),
  );
  r.patch("/:id", async (c) =>
    c.json(
      await updateFeedback(
        d,
        c.get("actor"),
        parseIdParam(c),
        await parseJson(c, FeedbackUpdateRequestSchema),
      ),
    ),
  );
  fileRoute(r, d);
  return r;
}
