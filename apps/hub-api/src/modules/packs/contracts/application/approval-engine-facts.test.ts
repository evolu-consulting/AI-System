// CR-121 D-1 · tool `contracts-route` / `contracts-finalize` dựng dữ kiện HIỆN TẠI (phòng ban người tạo + đối tác mới) và chỉ đọc
// nguồn nào mẫu chụp cần (mẫu cũ ⇒ 0 lời đọc thêm). Uow/cổng giả.
import { describe, expect, it } from "bun:test";
import type { FlowStep } from "../domain/approval-flow.types";
import type { ApprovalEngineTxRepos, EngineRunRow } from "./approval-engine.ports";
import { type FinalizeDeps, finalizeRun, routeStep } from "./approval-engine.usecase";

const T = "00000000-0000-4000-8000-0000000000a1";
const U = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const RUN = "00000000-0000-4000-8000-0000000000e1";
const G = "00000000-0000-4000-8000-0000000000f1";
const ctx = { tenantId: T, userId: U, processRunId: RUN };

const review = (key: string, when: unknown = null) =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: G,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when,
  }) as FlowStep;
const DEPT = { op: "and", conds: [{ field: "creator_department", in: ["sales"] }] };
const NEW = { op: "and", conds: [{ field: "new_partner", is: true }] };
const BIG = { op: "and", conds: [{ field: "total_value", op: "ge", value: 500_000_000 }] };

type W = { row: EngineRunRow; depts: string[]; partner: boolean | null; calls: string[] };
const world = (steps: FlowStep[], o: Partial<EngineRunRow> = {}): W => ({
  row: {
    contractId: C,
    approvalId: "00000000-0000-4000-8000-0000000000d1",
    approvalStatus: "level1",
    contractStatus: "needs_review",
    deal: "buy",
    totalValue: 600_000_000,
    flowSteps: steps,
    pendingLinks: null,
    ...o,
  },
  depts: [],
  partner: null,
  calls: [],
});

function deps(w: W): FinalizeDeps {
  const r = {
    approvalEngine: {
      byRun: async () => w.row,
      finalize: async () => {
        w.calls.push("finalize");
        return true;
      },
    },
    flowFacts: {
      newPartner: async () => {
        w.calls.push("partner");
        return w.partner;
      },
    },
  } as unknown as ApprovalEngineTxRepos;
  return {
    uow: { tenant: async (_who, fn) => fn(r) },
    bridge: {
      port: {
        passedStages: async () =>
          w.calls.filter((c) => c.startsWith("pass:")).map((c) => c.slice(5)),
        lastApprover: async () => U,
      } as never,
    },
    afterApproved: undefined,
    groups: {
      creatorDepartments: async (t, u) => {
        w.calls.push(`depts:${t === T && u === U}`);
        return w.depts;
      },
    },
  };
}
const route = (w: W, from = 0) => routeStep(deps(w))(ctx, { contract_id: C, from_step: from });

describe("CR-121 D-1 · contracts-route theo dữ kiện hiện tại", () => {
  it("mẫu cũ (giá trị) ⇒ không đọc phòng ban / đối tác; sửa giá trị giữa lượt ⇒ lần rẽ sau bỏ bước", async () => {
    const w = world([review("l1"), review("gd", BIG)]);
    expect(await route(w)).toEqual({ next: 2 });
    w.row = { ...w.row, totalValue: 100_000_000 };
    expect(await route(w)).toEqual({ next: 3 });
    expect(w.calls).toEqual([]);
  });
  it("phòng ban người bắt đầu (đã gồm phòng cha) quyết bước; đọc theo danh tính run", async () => {
    const w = world([review("l1"), review("kd", DEPT)]);
    w.depts = ["sales", "sales-hn"];
    expect(await route(w)).toEqual({ next: 2 });
    w.depts = ["ops"];
    expect(await route(w)).toEqual({ next: 3 });
    w.depts = [];
    expect(await route(w)).toEqual({ next: 2 }); // chưa có dữ liệu ⇒ bước chạy
    expect(w.calls).toEqual(["depts:true", "depts:true", "depts:true"]);
  });
  it("đối tác mới: false ⇒ bỏ bước; null (chưa gắn đối tác) ⇒ bước chạy", async () => {
    const w = world([review("l1"), review("moi", NEW)]);
    w.partner = false;
    expect(await route(w)).toEqual({ next: 3 });
    w.partner = null;
    expect(await route(w)).toEqual({ next: 2 });
    expect(w.calls).toEqual(["partner", "partner"]);
  });
});

describe("CR-121 D-1 · contracts-finalize kiểm lại cùng dữ kiện", () => {
  it("bước phòng ban áp dụng mà chưa Đạt ⇒ từ chối; phòng khác (bước không bắt buộc) ⇒ ghi Đã duyệt", async () => {
    const w = world([review("l1"), review("kd", DEPT)]);
    w.calls.push("pass:s0");
    w.depts = ["sales"];
    const err = await finalizeRun(deps(w))(ctx, { contract_id: C }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    w.depts = ["ops"];
    expect(await finalizeRun(deps(w))(ctx, { contract_id: C })).toEqual({});
    expect(w.calls.filter((c) => c === "finalize")).toEqual(["finalize"]);
  });
});
