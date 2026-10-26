// contract-flow S3a · use case duyệt trên engine với cổng/uow giả: mở run (ensureDef → start ref → gắn → kick; gắn hụt ⇒ huỷ bù;
// Group thiếu / engine vắng ⇒ máy cũ), tool `contracts-route` (next theo giá trị hiện tại) và `contracts-finalize` (kiểm bước bắt
// buộc, ghi + gắn SP cùng tx; lỗi gắn SP ⇒ ném; chạy lại sau khi đã ghi ⇒ ok; không run / HĐ khác ⇒ ném).
import { describe, expect, it } from "bun:test";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import type { FlowStep } from "../domain/approval-flow.rules";
import type {
  ApprovalEnginePort,
  ApprovalEngineRepo,
  ApprovalEngineTxRepos,
  EngineRunRow,
  EngineStartRow,
} from "./approval-engine.ports";
import {
  type ApprovalEngineDeps,
  finalizeRun,
  routeStep,
  startEngineApproval,
} from "./approval-engine.usecase";
import type { StoredFlow } from "./approval-flow.usecase";
import type { ProductLinksOutcome } from "./product-links.usecase";

const T = "00000000-0000-4000-8000-0000000000a1";
const U = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const AID = "00000000-0000-4000-8000-0000000000d1";
const RUN = "00000000-0000-4000-8000-0000000000e1";
const G1 = "00000000-0000-4000-8000-0000000000f1";
const G2 = "00000000-0000-4000-8000-0000000000f2";
const SETTINGS: ApprovalSettings = { threshold: 1000, level1GroupKey: "k1", level2GroupKey: "k2" };
const who = { tenantId: T, userId: U };

type World = {
  st: EngineStartRow | null;
  flow: StoredFlow | null;
  run: EngineRunRow | null;
  attachOk: boolean;
  finalized: boolean;
  links: ProductLinksOutcome;
  calls: string[];
  groups: string[];
};
const world = (o: Partial<World> = {}): World => ({
  st: { approvalId: AID, approvalStatus: "level1", mode: "machine", engineRunId: null },
  flow: null,
  run: null,
  attachOk: true,
  finalized: true,
  links: { kind: "ok", created: 1, linked: 1, matched: 1 },
  calls: [],
  groups: [G1, G2],
  ...o,
});

function txRepos(w: World): ApprovalEngineTxRepos {
  const repo: ApprovalEngineRepo = {
    byRun: async (runId, o) => {
      w.calls.push(`byRun:${runId}:${o.lock}`);
      return w.run;
    },
    startState: async () => w.st,
    attach: async (_id, _aid, a) => {
      w.calls.push(`attach:${a.runId}:v${a.version}:${a.steps.length}`);
      return w.attachOk;
    },
    finalize: async (_id, _aid, _run, by) => {
      w.calls.push(`finalize:${by}`);
      return w.finalized;
    },
    setPendingLinks: async () => true,
    labels: async () => [],
    difyFacts: async () => ({ title: "HĐ A", deal: "buy", totalValue: 5000, partner: "Cty B" }),
  };
  return {
    approvalEngine: repo,
    approvalFlow: {
      settings: async () => SETTINGS,
      settingsRev: async () => 0,
      flow: async () => w.flow,
      save: async () => null,
    },
    links: {
      link: async (_id: string, l: readonly unknown[], actor: string) => {
        w.calls.push(`link:${l.length}:${actor}`);
        return w.links;
      },
    },
    outbox: { enqueue: async () => undefined },
  } as unknown as ApprovalEngineTxRepos;
}

function deps(w: World, port: Partial<ApprovalEnginePort> | null = {}): ApprovalEngineDeps {
  const r = txRepos(w);
  const full: ApprovalEnginePort = {
    ensureDef: async (_u, key, _def, v) => {
      w.calls.push(`ensureDef:${key}:v${v}`);
      return "created";
    },
    start: async (_u, req) => {
      w.calls.push(`start:${req.ref.pack}:${req.ref.record_id}`);
      return { runId: RUN, kick: async () => void w.calls.push("kick") };
    },
    cancel: async (_u, id) => void w.calls.push(`cancel:${id}`),
    passedStages: async () => ["s0"],
    lastApprover: async () => U,
    act: async () => "ok",
    cancelSys: async () => true,
    stepsView: async () => null,
    outcomesOf: async () => [],
    openTasksOf: async () => [],
    workflowsOf: async () => [],
    ...port,
  };
  return {
    bridge: port === null ? {} : { port: full },
    uow: { tenant: async (_w, fn) => fn(r) },
    groups: {
      idsOf: async () =>
        new Map([
          ["k1", G1],
          ["k2", G2],
        ]),
      existingIds: async () => new Set(w.groups),
    },
    warn: (m) => void w.calls.push(`warn:${m}`),
  };
}

const runRow = (o: Partial<EngineRunRow> = {}): EngineRunRow => ({
  contractId: C,
  approvalId: AID,
  approvalStatus: "level1",
  contractStatus: "needs_review",
  deal: "buy",
  totalValue: 10,
  flowSteps: [
    {
      kind: "review",
      key: "l1",
      name: "l1",
      department_group_id: G1,
      head_only: false,
      due_h: 72,
      remind_every_h: null,
      escalate_group_id: null,
      exclude_starter: false,
      when: null,
    },
    {
      kind: "review",
      key: "l2",
      name: "l2",
      department_group_id: G2,
      head_only: false,
      due_h: 72,
      remind_every_h: null,
      escalate_group_id: null,
      exclude_starter: true,
      when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 1000 }] },
    },
  ] as FlowStep[],
  pendingLinks: null,
  ...o,
});
const ctx = { tenantId: T, userId: U, processRunId: RUN };

describe("startEngineApproval", () => {
  it("mẫu mặc định ⇒ ensureDef v1 → start ref contracts → gắn (2 bước) → kick", async () => {
    const w = world();
    expect(await startEngineApproval(deps(w))(who, C)).toBe("started");
    expect(w.calls).toEqual([
      "ensureDef:contracts-approval:v1",
      `start:contracts:${C}`,
      `attach:${RUN}:v1:2`,
      "kick",
    ]);
  });
  it("mẫu đã lưu ⇒ version của mẫu; gắn hụt ⇒ huỷ bù, không kick", async () => {
    const steps = runRow().flowSteps;
    const w = world({ flow: { version: 5, steps, updatedAt: "x" }, attachOk: false });
    expect(await startEngineApproval(deps(w))(who, C)).toBe("skipped");
    expect(w.calls).toEqual([
      "ensureDef:contracts-approval:v100000005",
      `start:contracts:${C}`,
      `attach:${RUN}:v5:2`,
      `cancel:${RUN}`,
    ]);
  });
  it("engine vắng ⇒ máy; Group thiếu ⇒ máy, không gọi engine; lượt không mở được ⇒ skipped", async () => {
    expect(await startEngineApproval(deps(world(), null))(who, C)).toBe("machine");
    const w = world({ groups: [G1] });
    expect(await startEngineApproval(deps(w))(who, C)).toBe("machine");
    expect(w.calls).toEqual(["warn:contract-engine-flow-invalid"]);
    const w2 = world({
      st: { approvalId: AID, approvalStatus: "level1", mode: "engine", engineRunId: RUN },
    });
    expect(await startEngineApproval(deps(w2))(who, C)).toBe("skipped");
    expect(w2.calls).toEqual([]);
  });
  it("engine ném ⇒ log, máy cũ (không ném)", async () => {
    const w = world();
    const d = deps(w, { start: async () => Promise.reject(new Error("boom")) });
    expect(await startEngineApproval(d)(who, C)).toBe("machine");
    expect(w.calls.at(-1)).toBe("warn:contract-engine-start-failed");
  });
});

describe("contracts-route", () => {
  it("next theo giá trị hiện tại; HĐ khác / không run / from sai ⇒ ném", async () => {
    const w = world({ run: runRow() });
    const route = routeStep(deps(w));
    expect(await route(ctx, { contract_id: C, from_step: 0 })).toEqual({ next: 3 });
    w.run = runRow({ totalValue: 5000 });
    expect(await route(ctx, { contract_id: C, from_step: 0 })).toEqual({ next: 2 });
    expect(await route(ctx, { contract_id: C, from_step: 1 })).toEqual({ next: 3 });
    await expect(route(ctx, { contract_id: C, from_step: 7 })).rejects.toThrow();
    await expect(
      route({ ...ctx, processRunId: null }, { contract_id: C, from_step: 0 }),
    ).rejects.toThrow();
    w.run = runRow({ contractId: AID });
    await expect(route(ctx, { contract_id: C, from_step: 0 })).rejects.toThrow();
    w.run = null; // run của tenant khác ⇒ repo (lọc tenant) không thấy
    await expect(route(ctx, { contract_id: C, from_step: 0 })).rejects.toThrow();
  });
});

describe("contracts-finalize", () => {
  it("đủ bước ⇒ ghi Đã duyệt (người Đạt gần nhất) + gắn SP chờ cùng tx", async () => {
    const w = world({ run: runRow({ pendingLinks: [{ item_id: C, product_id: G1 }] }) });
    expect(await finalizeRun(deps(w))(ctx, { contract_id: C })).toEqual({});
    expect(w.calls).toEqual([`byRun:${RUN}:true`, `finalize:${U}`, `link:1:${U}`]);
  });
  it("giá trị HIỆN TẠI cần bước 2 chưa Đạt ⇒ ném, không ghi", async () => {
    const w = world({ run: runRow({ totalValue: 5000 }) });
    await expect(finalizeRun(deps(w))(ctx, { contract_id: C })).rejects.toThrow("required");
    expect(w.calls).toEqual([`byRun:${RUN}:true`]);
  });
  it("gắn SP lỗi ⇒ ném (ROLLBACK ⇒ không khoá); chưa có người Đạt ⇒ ném", async () => {
    const w = world({
      run: runRow({ pendingLinks: [{}] }),
      links: { kind: "not_confirmed" },
    });
    await expect(finalizeRun(deps(w))(ctx, { contract_id: C })).rejects.toThrow("product-links");
    const w2 = world({ run: runRow() });
    await expect(
      finalizeRun(deps(w2, { lastApprover: async () => null }))(ctx, { contract_id: C }),
    ).rejects.toThrow();
  });
  it("đã ghi ở lần trước ⇒ ok, không ghi lại; không run / HĐ không thuộc run ⇒ ném", async () => {
    const w = world({ run: runRow({ approvalStatus: "done" }) });
    expect(await finalizeRun(deps(w))(ctx, { contract_id: C })).toEqual({});
    expect(w.calls).toEqual([`byRun:${RUN}:true`]);
    await expect(
      finalizeRun(deps(w))({ ...ctx, processRunId: undefined }, { contract_id: C }),
    ).rejects.toThrow();
    const w2 = world({ run: null });
    await expect(finalizeRun(deps(w2))(ctx, { contract_id: C })).rejects.toThrow("not in run");
  });
});
