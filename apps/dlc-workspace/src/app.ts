// dlc-dify · API workspace DLC (Bearer `DLC_WS_TOKEN`): project = repo git + queue; tool của agent (đọc/ghi file theo
// nhánh, chạy lệnh trong container, commit) và bước của flow Dify (nhận việc vào queue, lấy việc kế, `integrate` = merge
// tuần tự + test trên main + ghi kết quả queue, artifact spec/plan/test vào `docs/dlc/`); hộp ticket Trello (cron gọi hook).
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { runInContainer } from "./exec";
import { commitAll, ensureWorktree, initRepo, log, repoDir, withLock } from "./git";
import { BRANCH_RE, body, HttpError, KEY_RE, now } from "./http";
import { queueRoutes } from "./queue.routes";
import { safeId, summary } from "./queue.rules";
import type { Project, Store } from "./store";
import { ticketRoutes } from "./tickets.routes";

export type AppCfg = { store: Store; token: string; image: string; execMaxS: number };

const SKIP = new Set(["node_modules", ".git", ".venv", "__pycache__", "dist", "coverage"]);
const digest = (s: string) => createHash("sha256").update(s).digest();

/** Đường dẫn tương đối trong worktree (không thoát ra ngoài, không đụng `.git`). */
function safePath(base: string, rel: string): string {
  const p = resolve(base, rel || ".");
  const r = relative(base, p);
  if (r.startsWith("..") || resolve(base, r) !== p || r.split(/[\\/]/).includes(".git"))
    throw new HttpError(400, "path outside workspace");
  return p;
}

function listFiles(base: string, dir: string, out: string[], max = 600): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= max) break;
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) listFiles(base, full, out, max);
    else out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

/** Ngữ cảnh chung của các nhóm route: cấu hình, kho, tra project / nhánh (ném 4xx khi sai). */
type Ctx = {
  cfg: AppCfg;
  store: Store;
  proj: (key: string) => Project;
  branchOf: (b: string | undefined) => string;
};

const NewProjectSchema = z.object({
  key: z.string().regex(KEY_RE),
  title: z.string().min(1).max(200),
  conversation_id: z.string().max(64).optional(),
  kh_project: z.string().max(100).optional(),
  stack: z.string().max(200).optional(),
});

/** Tạo project (repo git nếu chưa có) hoặc cập nhật hội thoại / project KH gắn với nó. */
async function upsertProject(store: Store, b: z.infer<typeof NewProjectSchema>) {
  const created = await initRepo(store.root, b.key, b.title);
  const cur = store.project(b.key);
  const p: Project = cur ?? {
    key: b.key,
    title: b.title,
    conversation_id: b.conversation_id ?? null,
    kh_project: b.kh_project ?? null,
    stack: b.stack ?? "",
    test_command: null,
    created_at: now(),
    queue: [],
  };
  if (cur) {
    p.conversation_id = b.conversation_id ?? cur.conversation_id;
    p.kh_project = b.kh_project ?? cur.kh_project;
  }
  await store.saveProject(p);
  return { project: p.key, created, repo: repoDir(store.root, p.key) };
}

/** Project: tạo (repo git + gắn hội thoại), liệt kê, xem, đặt lệnh test. */
function projectRoutes(app: Hono, x: Ctx): void {
  const { store, proj } = x;
  app.post("/projects", async (c) => {
    const r = await upsertProject(store, await body(c, NewProjectSchema));
    return c.json(r, r.created ? 201 : 200);
  });
  app.get("/projects", (c) =>
    c.json({
      items: store.projects().map((p) => ({ key: p.key, title: p.title, queue: summary(p.queue) })),
    }),
  );
  app.get("/projects/:key", async (c) => {
    const p = proj(c.req.param("key"));
    return c.json({ ...p, summary: summary(p.queue), log: await log(repoDir(store.root, p.key)) });
  });
  app.put("/projects/:key/settings", async (c) => {
    const key = proj(c.req.param("key")).key;
    const b = await body(
      c,
      z.object({
        test_command: z.string().max(2000).optional(),
        stack: z.string().max(200).optional(),
      }),
    );
    const p = await store.update(key, (p) => {
      const project = {
        ...p,
        ...(b.test_command !== undefined && { test_command: b.test_command }),
        ...(b.stack !== undefined && { stack: b.stack }),
      };
      return { project, value: project };
    });
    return c.json(p);
  });
}

/** File theo nhánh (tool của agent): liệt kê / đọc / ghi trong worktree. */
function fileRoutes(app: Hono, x: Ctx): void {
  const { store, proj, branchOf } = x;
  app.get("/projects/:key/files", async (c) => {
    const p = proj(c.req.param("key"));
    const dir = await ensureWorktree(store.root, p.key, branchOf(c.req.query("branch")));
    const target = safePath(dir, c.req.query("path") ?? "");
    if (!existsSync(target)) return c.json({ exists: false, path: c.req.query("path") ?? "" });
    if (statSync(target).isDirectory())
      return c.json({ exists: true, type: "dir", files: listFiles(dir, target, []) });
    const content = readFileSync(target, "utf8");
    return c.json({
      exists: true,
      type: "file",
      content: content.slice(0, 200_000),
      truncated: content.length > 200_000,
    });
  });
  app.put("/projects/:key/files", async (c) => {
    const p = proj(c.req.param("key"));
    const b = await body(
      c,
      z.object({
        branch: z.string().optional(),
        path: z.string().min(1).max(400),
        content: z.string().max(1_000_000),
      }),
    );
    const dir = await ensureWorktree(store.root, p.key, branchOf(b.branch));
    const target = safePath(dir, b.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, b.content);
    return c.json({ ok: true, path: b.path, bytes: Buffer.byteLength(b.content) });
  });
}

/** Lệnh trong container, commit, tài liệu quy trình `docs/dlc/`. */
function execRoutes(app: Hono, x: Ctx): void {
  const { cfg, store, proj, branchOf } = x;
  app.post("/projects/:key/exec", async (c) => {
    const p = proj(c.req.param("key"));
    const b = await body(
      c,
      z.object({
        branch: z.string().optional(),
        command: z.string().max(4000),
        timeout_s: z.number().int().min(5).max(cfg.execMaxS).optional(),
        skip: z.boolean().optional(),
      }),
    );
    if (b.skip || !b.command.trim()) return c.json({ skipped: true });
    const dir = await ensureWorktree(store.root, p.key, branchOf(b.branch));
    return c.json(
      await runInContainer({
        dir,
        command: b.command,
        timeoutS: b.timeout_s ?? 600,
        image: cfg.image,
      }),
    );
  });
  app.post("/projects/:key/commit", async (c) => {
    const p = proj(c.req.param("key"));
    const b = await body(
      c,
      z.object({ branch: z.string().optional(), message: z.string().min(1).max(500) }),
    );
    const dir = await ensureWorktree(store.root, p.key, branchOf(b.branch));
    return c.json(
      await withLock(`commit:${p.key}:${b.branch ?? "main"}`, () => commitAll(dir, b.message)),
    );
  });
  app.put("/projects/:key/artifacts/:name", async (c) => {
    const p = proj(c.req.param("key"));
    const name = safeId(c.req.param("name"));
    const b = await body(c, z.object({ content: z.string().max(1_000_000) }));
    const dir = repoDir(store.root, p.key);
    const r = await withLock(p.key, async () => {
      const f = join(dir, "docs", "dlc", `${name}.md`);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, b.content);
      return commitAll(dir, `docs(dlc): ${name}`);
    });
    return c.json({ ok: true, path: `docs/dlc/${name}.md`, ...r });
  });
}

/** File spec người dùng tải lên (tool dlc-spec-upload); quy trình đọc lại khi chạy / chạy lại. */
function specRoutes(app: Hono, x: Ctx): void {
  const { store, proj } = x;
  app.post("/projects/:key/spec-files", async (c) => {
    const p = proj(c.req.param("key"));
    const b = await body(
      c,
      z.object({ name: z.string().min(1).max(200), content: z.string().max(1_000_000) }),
    );
    const name = safeId(b.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase()) || "spec";
    const dir = repoDir(store.root, p.key);
    const r = await withLock(p.key, async () => {
      const f = join(dir, "docs", "dlc", "spec", `${name}.md`);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, `<!-- source: ${b.name.replace(/-->/g, "")} -->\n${b.content}`);
      return commitAll(dir, `docs(dlc): spec file ${name}`);
    });
    return c.json({ ok: true, path: `docs/dlc/spec/${name}.md`, chars: b.content.length, ...r });
  });
  app.get("/projects/:key/spec-files", (c) => {
    const p = proj(c.req.param("key"));
    const dir = join(repoDir(store.root, p.key), "docs", "dlc", "spec");
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => ({ name: f, content: readFileSync(join(dir, f), "utf8") }))
      : [];
    const text = files.map((f) => `## spec file ${f.name}\n${f.content}`).join("\n\n");
    return c.json({ files: files.map((f) => f.name), text });
  });
}

export function createApp(cfg: AppCfg) {
  const { store } = cfg;
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    return c.json({ error: (err as Error).message.slice(0, 500) }, 500);
  });
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const h = c.req.header("Authorization") ?? "";
    const given = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!given || !timingSafeEqual(digest(given), digest(cfg.token)))
      return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  const proj = (key: string): Project => {
    if (!KEY_RE.test(key)) throw new HttpError(400, "bad project key");
    const p = store.project(key);
    if (!p) throw new HttpError(404, `project ${key} not found`);
    return p;
  };
  const branchOf = (b: string | undefined) => {
    const v = b?.trim() || "main";
    if (!BRANCH_RE.test(v)) throw new HttpError(400, "bad branch");
    return v;
  };
  const x: Ctx = { cfg, store, proj, branchOf };
  projectRoutes(app, x);
  fileRoutes(app, x);
  execRoutes(app, x);
  specRoutes(app, x);
  queueRoutes(app, { store, image: cfg.image, execMaxS: cfg.execMaxS, proj });
  ticketRoutes(app, store);
  return app;
}
