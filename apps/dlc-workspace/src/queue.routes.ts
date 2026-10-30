// dlc-dify · queue của project (bước của flow Dify): nhận việc, lấy việc kế (một việc `in_progress` ⇒ tuần tự), `integrate`
// = merge nhánh việc vào main + cổng test (test-gate.rules: xanh hết, hoặc không thụt lùi so với main trước merge; bị từ
// chối ⇒ main về commit cũ, việc về đầu queue), ghi kết quả.
import type { Hono } from "hono";
import { z } from "zod";
import { runInContainer } from "./exec";
import { ensureWorktree, mainSha, mergeToMain, repoDir, resetMain } from "./git";
import { body, now } from "./http";
import { enqueue, next, result, summary } from "./queue.rules";
import type { Project, Store } from "./store";
import { describeRun, gateOk, type TestRun, testCounts } from "./test-gate.rules";

export type QueueDeps = {
  store: Store;
  image: string;
  execMaxS: number;
  proj: (key: string) => Project;
};

/** Lý do merge hỏng (xung đột / nhánh không có gì mới); merge được ⇒ "". */
function mergeFailure(m: { ok: boolean; conflicts: string[]; message: string }): string {
  if (m.ok) return "";
  if (m.conflicts.length === 0) return m.message;
  return `MERGE CONFLICT in: ${m.conflicts.join(", ")}\n${m.message}`;
}

const ItemSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(300),
  domain: z.string().max(80).optional(),
  detail: z.string().max(20_000).optional(),
  acceptance: z.string().max(20_000).optional(),
  source: z.string().max(200).optional(),
});

/** Chạy lệnh test của project trên main + mốc so sánh (cache theo sha của main). */
function testRunner(d: QueueDeps) {
  const { store } = d;
  /** Lệnh test của project trên `main` (container) → mã thoát + số test đạt/lỗi + output. */
  const runTests = async (p: Project, timeoutS: number): Promise<TestRun & { text: string }> => {
    const command = p.test_command ?? "true";
    const t = await runInContainer({
      dir: repoDir(store.root, p.key),
      command,
      timeoutS,
      image: d.image,
    });
    const exit = t.timed_out ? 124 : t.exit_code;
    const text = `$ ${command}\nexit=${t.exit_code}${t.timed_out ? " (timeout)" : ""}\n${t.output}`;
    return { exit, counts: testCounts(t.output), text };
  };
  const saveBaseline = (key: string, b: NonNullable<Project["test_baseline"]>) =>
    store.update(key, (pp) => ({
      project: { ...pp, test_baseline: { sha: b.sha, exit: b.exit, counts: b.counts } },
      value: null,
    }));
  const baselineOf = async (p: Project, sha: string, timeoutS: number): Promise<TestRun> => {
    if (p.test_baseline?.sha === sha) return p.test_baseline;
    const t = await runTests(p, timeoutS);
    await saveBaseline(p.key, { sha, ...t });
    return t;
  };
  return { runTests, saveBaseline, baselineOf };
}

function integrator(d: QueueDeps) {
  const { store } = d;
  const { runTests, saveBaseline, baselineOf } = testRunner(d);
  /** Merge nhánh vào main + cổng test (không thụt lùi so với main trước merge); bị từ chối ⇒ main về commit cũ. */
  return async (p: Project, branch: string, timeoutS: number) => {
    const preSha = await mainSha(store.root, p.key);
    // Mốc so sánh = test trên main trước merge (cache theo sha; lần đầu chạy một lần).
    const base = p.test_command ? await baselineOf(p, preSha, timeoutS) : null;
    const merged = await mergeToMain(store.root, p.key, branch);
    // Nhánh trống: chỉ đạt khi main đã xanh hoàn toàn (việc đã được việc trước làm luôn); còn lại = chưa làm.
    if (merged.noChanges && base?.exit === 0)
      return {
        ok: true,
        merged,
        output: "",
        note: `no changes needed; main already green (${describeRun(base)})`,
      };
    if (!merged.ok) {
      const output = mergeFailure(merged);
      return { ok: false, merged, output, note: `attempt failed: ${output.slice(-3000)}` };
    }
    if (!p.test_command) return { ok: true, merged, output: "", note: `merged ${merged.sha}` };
    const t = await runTests(p, timeoutS);
    const ok = gateOk(base, t);
    const gate = `main before: ${base ? describeRun(base) : "?"}; after merge: ${describeRun(t)}`;
    const output = `${gate}\n${t.text}`;
    if (!ok) {
      await resetMain(store.root, p.key, preSha);
      const note = `attempt failed (regression; main reset to ${preSha.slice(0, 7)}): ${output.slice(-3000)}`;
      return { ok, merged, output, note };
    }
    await saveBaseline(p.key, { sha: await mainSha(store.root, p.key), ...t });
    return { ok, merged, output, note: `merged ${merged.sha}; ${gate}` };
  };
}

export function queueRoutes(app: Hono, d: QueueDeps): void {
  const { store, proj } = d;
  app.get("/projects/:key/queue", (c) => {
    const p = proj(c.req.param("key"));
    return c.json({ items: p.queue, summary: summary(p.queue) });
  });
  app.post("/projects/:key/queue", async (c) => {
    const key = proj(c.req.param("key")).key;
    const b = await body(c, z.object({ items: z.array(ItemSchema).max(100) }));
    const q = await store.update(key, (p) => {
      const queue = enqueue(p.queue, b.items, now());
      return { project: { ...p, queue }, value: queue };
    });
    return c.json({ items: q, summary: summary(q ?? []) });
  });
  app.post("/projects/:key/queue/next", async (c) => {
    const key = proj(c.req.param("key")).key;
    const r = await store.update(key, (p) => {
      const n = next(p.queue, now());
      return {
        project: { ...p, queue: n.queue },
        value: { item: n.item, summary: summary(n.queue) },
      };
    });
    if (r?.item?.branch) await ensureWorktree(store.root, key, r.item.branch);
    return c.json(r);
  });
  integrateRoutes(app, d);
}

/** `integrate` (merge + cổng test) và ghi kết quả việc. */
function integrateRoutes(app: Hono, d: QueueDeps): void {
  const { store, proj } = d;
  const integrateBranch = integrator(d);
  /** Việc đang làm: commit nhánh → merge tuần tự vào main → chạy test trên main → ghi kết quả (lỗi ⇒ về đầu queue). */
  app.post("/projects/:key/integrate", async (c) => {
    const p = proj(c.req.param("key"));
    const b = await body(
      c,
      z.object({
        task_id: z.string().max(80).optional(),
        skip: z.boolean().optional(),
        timeout_s: z.number().int().min(10).max(d.execMaxS).optional(),
      }),
    );
    const item = p.queue.find((x) => x.id === b.task_id && x.status === "in_progress");
    if (b.skip || !item?.branch) return c.json({ skipped: true });
    const { ok, merged, output, note } = await integrateBranch(p, item.branch, b.timeout_s ?? 900);
    const r = await store.update(p.key, (pp) => {
      const x = result(pp.queue, item.id, { ok, note }, now());
      return {
        project: { ...pp, queue: x.queue },
        value: { item: x.item, summary: summary(x.queue) },
      };
    });
    return c.json({
      ok,
      merged: merged.ok,
      sha: merged.sha,
      conflicts: merged.conflicts,
      output,
      item: r?.item,
      summary: r?.summary,
    });
  });
  app.post("/projects/:key/queue/:id/result", async (c) => {
    const key = proj(c.req.param("key")).key;
    const b = await body(c, z.object({ ok: z.boolean(), note: z.string().max(8000).optional() }));
    const r = await store.update(key, (p) => {
      const x = result(p.queue, c.req.param("id"), { ok: b.ok, note: b.note ?? "" }, now());
      return { project: { ...p, queue: x.queue }, value: x.item };
    });
    return c.json({ item: r });
  });
}
