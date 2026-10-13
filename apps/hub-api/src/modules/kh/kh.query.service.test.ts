// HUB-FR-132 · plan K1 §3.4 bước 2–3 · unit `kh.query.service` phần không chạm DB: `khJobCtx`, `tools/list`, nhận lời gọi,
// INVALID_ARGS / KH_PROJECT trả ngay (không đọc DB, không gọi KH). Luồng đếm/hạ cấp: `tests/acceptance/K1/query.int.test.ts`.
import { describe, expect, it } from "bun:test";
import type { KhJobItem } from "./kh.agent.rules";
import { khPrepareJob } from "./kh.job";
import type { KhRuntime } from "./kh.mount";
import { type KhMcpCtx, KhQueryService, khJobCtx } from "./kh.query.service";

const SR = "5f0c0000-0000-4000-8000-000000000001";
const item = (n: string, id: string, projects: string[], sp: string | null): KhJobItem => ({
  connection_id: id,
  name: n,
  summary_project: sp,
  projects,
});
const A = item("kh-main", "c1a10000-0000-4000-8000-000000000041", ["proj-a", "proj-b"], "proj-a");
const B = item("kh-alt", "c1a10000-0000-4000-8000-000000000042", ["proj-c"], null);

const noDb = new Proxy({}, { get: () => () => Promise.reject(new Error("db touched")) });
const svc = new KhQueryService({
  db: noDb as never,
  rt: {} as KhRuntime,
  log: { warn: () => {} },
});
const ctx = (items: KhJobItem[] | null, tools = ["kh-query"]): KhMcpCtx => ({
  tenantId: "t",
  runId: "r",
  tools,
  kh: items ? { items, stageRunId: SR } : null,
});
const text = (r: { content: { text: string }[] }) => r.content[0]?.text;

describe("khJobCtx", () => {
  it("HUB-FR-132 · items hợp lệ + stage ⇒ ctx; thiếu stage / null / sai hình ⇒ null", () => {
    expect(khJobCtx([A], SR)).toEqual({ items: [A], stageRunId: SR });
    expect(khJobCtx([A], null)).toBeNull();
    expect(khJobCtx(null, SR)).toBeNull();
    expect(khJobCtx([], SR)).toBeNull();
    expect(khJobCtx([{ name: "x" }], SR)).toBeNull();
  });
});

describe("KhQueryService · tools/accepts", () => {
  it("HUB-FR-132 · có ctx.kh ∧ tools ∋ kh-query ⇒ 1 tool; thiếu một trong hai ⇒ không", () => {
    const t = svc.tools(ctx([A]));
    expect(t.map((x) => x.name)).toEqual(["kh-query"]);
    expect(String(t[0]?.description).endsWith("Default: proj-a.")).toBe(true);
    expect(svc.tools(ctx([A], []))).toEqual([]);
    expect(svc.tools(ctx(null))).toEqual([]);
    expect(svc.accepts(ctx([A]), "kh-query")).not.toBeNull();
    expect(svc.accepts(ctx([A]), "other")).toBeNull();
    expect(svc.accepts(ctx(null), "kh-query")).toBeNull();
  });
  it("HUB-FR-132 · G3 · args sai ⇒ INVALID_ARGS, không đụng DB", async () => {
    const call = svc.accepts(ctx([A]), "kh-query");
    for (const a of [undefined, { query: "" }, { query: "q", x: 1 }, { project: "proj-a" }]) {
      const r = await call?.call(a);
      expect([r?.isError, r && text(r)]).toEqual([true, "Invalid arguments for this tool."]);
    }
  });
  it("HUB-FR-132 · G4 · project sai / không mặc định ⇒ KH_PROJECT liệt kê nhãn, không đụng DB", async () => {
    const r = await svc.accepts(ctx([A, B]), "kh-query")?.call({ query: "q", project: "proj-a" });
    expect(r && text(r)).toBe(
      "Pass project as one of: kh-main/proj-a, kh-main/proj-b, kh-alt/proj-c.",
    );
    const n = await svc.accepts(ctx([B]), "kh-query")?.call({ query: "q" });
    expect([n?.isError, n && text(n)]).toEqual([true, "Pass project as one of: proj-c."]);
  });
});

describe("khPrepareJob", () => {
  const prep = khPrepareJob({ db: noDb as never, rt: {} as KhRuntime, log: { warn: () => {} } });
  it("HUB-FR-132 · Q10 · không phải job stage / runtime khác ⇒ [] không đụng DB", async () => {
    expect(
      await prep({ agentId: "a", runtime: "agentic-cli", stageJob: false, runId: "r" }),
    ).toEqual([]);
    expect(await prep({ agentId: "a", runtime: "dify-chat", stageJob: true, runId: "r" })).toEqual(
      [],
    );
  });
  it("HUB-FR-132 · lỗi DB ⇒ [] + warn (không ném)", async () => {
    const warns: string[] = [];
    const p = khPrepareJob({
      db: noDb as never,
      rt: {} as KhRuntime,
      log: { warn: (m: string) => warns.push(m) },
    });
    expect(await p({ agentId: "a", runtime: "agentic-cli", stageJob: true, runId: "r" })).toEqual(
      [],
    );
    expect(warns).toEqual(["kh-job-prepare-failed"]);
  });
});
