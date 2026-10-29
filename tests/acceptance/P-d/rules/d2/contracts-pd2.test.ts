// HUB-FR-146 · HUB-FR-147 · ADM-FR-73 · AC-H44 · AC-H45 · AC-A15 · test-plan-d2 §2 PD2-C01…C05 (plan-contract §6, plan-addendum A1):
// enum P-d2 nối CUỐI mảng, hằng, schema executor `tool`, `after.branch`, part `branch`, công tắc tool admin. Không DB/env.
// Export MỚI nạp lỏng ⇒ vắng = đỏ ở expect (lý do: T17/T18a chưa có). PD2-U20 `toggleChange` qua cổng lớp admin (T18a).
import { describe, expect, it } from "bun:test";
import { adminToolsFn, loadChat, loadHubAdmin, tryLoad } from "../../_support/modules";
import { agentDef, defInput, ok, schemaOf, X } from "../_contracts";

const chat = await loadChat();
const ha = await loadHubAdmin();
const wt = await tryLoad("packages/contracts/src/workflow-tools.ts");
const wtSchema = (name: string) => {
  let s: unknown;
  try {
    s = wt[name];
  } catch {
    throw new Error(`chưa có tính năng: contract workflow-tools ${name} (T17)`);
  }
  return schemaOf({ [name]: s }, name);
};

describe("PD2-C01 · enum nối cuối [plan-contract §6]", () => {
  it("AC-H45 · PD2-C01 · STAGE_RUN_STATUSES (11) cuối skipped; DECISION_REASONS (23) cuối tool_failed; EXECUTOR_KINDS (5) cuối tool", () => {
    expect([chat.STAGE_RUN_STATUSES?.length, chat.STAGE_RUN_STATUSES?.at(-1)]).toEqual([
      11,
      "skipped",
    ]);
    expect([chat.DECISION_REASONS?.length, chat.DECISION_REASONS?.at(-1)]).toEqual([
      23,
      "tool_failed",
    ]);
    // CR-103 nối cuối `set`, `if`: tiền tố 5 giá trị cũ giữ nguyên.
    expect(chat.EXECUTOR_KINDS?.slice(0, 5)).toEqual([
      "agent",
      "team",
      "apply",
      "wait_until",
      "tool",
    ]);
    expect(chat.EXECUTOR_KINDS?.slice(5)).toEqual(["set", "if"]);
  });
  it("AC-H44 · PD2-C01 · PROCESS_DEF_RULES.slice(17) = [TOOL_INVALID, TOOL_SIDE_EFFECT, BRANCH_INVALID]; PROCESS_REF_KINDS cuối tool", () => {
    // CR-103 nối cuối SET_INVALID, IF_INVALID: đoạn P-d2 (17..19) giữ nguyên.
    expect(ha.PROCESS_DEF_RULES?.slice(17, 20)).toEqual([
      "TOOL_INVALID",
      "TOOL_SIDE_EFFECT",
      "BRANCH_INVALID",
    ]);
    expect(ha.PROCESS_DEF_RULES?.slice(20)).toEqual(["SET_INVALID", "IF_INVALID"]);
    expect(ha.PROCESS_REF_KINDS).toEqual(["agent", "team", "group", "user", "source", "tool"]);
  });
  it("AC-H45 · PD2-C01 · ROOM_PROCESS_KINDS (8) cuối branch", () => {
    expect([chat.ROOM_PROCESS_KINDS?.length, chat.ROOM_PROCESS_KINDS?.at(-1)]).toEqual([
      8,
      "branch",
    ]);
  });
});

describe("PD2-C02 · hằng P-d2 [plan-contract §6]", () => {
  it("AC-H44 · PD2-C02 · TOOL_ARGS_MAX 20, TOOL_RESULT_MAX_BYTES 65536, BRANCH_RULES_MAX 10, BRANCH_OPS 6 op", () => {
    expect({
      a: chat.TOOL_ARGS_MAX,
      b: chat.TOOL_RESULT_MAX_BYTES,
      c: chat.BRANCH_RULES_MAX,
      d: chat.BRANCH_OPS,
    }).toEqual({ a: 20, b: 65_536, c: 10, d: ["eq", "ne", "lt", "le", "gt", "ge"] });
  });
});

const ARGS = {
  tong_tien: { from: "field", stage_key: "doc", field: "tong_tien" },
  ma_kh: { from: "input", key: "ma-kh" },
  gap: { from: "const", value: true },
};
const toolStage = (args: unknown = ARGS) =>
  agentDef({ key: "xuat", executor: { kind: "tool", tool_key: "xuat-hoa-don", args } });
const RULE = { field: "tong_tien", op: "gt", value: 20_000_000, goto_step: 3 };

describe("PD2-C03 · executor tool + after.branch [plan-contract §6]", () => {
  it("AC-H44 · PD2-C03 · executor tool nhận 3 loại nguồn; 21 args / tên tham số sai regex ⇒ lỗi", () => {
    const s = schemaOf(ha, "ProcessStageDefSchema");
    expect(ok(s, toolStage())).toBe(true);
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 21; i++) many[`a${i}`] = { from: "const", value: i };
    expect(ok(s, toolStage(many))).toBe(false);
    expect(ok(s, toolStage({ "1sai-ten": { from: "const", value: 1 } }))).toBe(false);
  });
  it("AC-H45 · PD2-C03 · after.branch mặc định [] ở review và auto; 10 luật ok, 11 lỗi; op 'in' lỗi", () => {
    const s = schemaOf(ha, "ProcessStageDefSchema");
    const rev = s.safeParse(agentDef());
    const auto = s.safeParse(agentDef({ after: { kind: "auto" } }));
    expect([rev.data?.after?.branch, auto.data?.after?.branch]).toEqual([[], []]);
    const br = (n: number, r: unknown = RULE) =>
      agentDef({ after: { kind: "auto", branch: Array.from({ length: n }, () => r) } });
    expect([ok(s, br(10)), ok(s, br(11)), ok(s, br(1, { ...RULE, op: "in" }))]).toEqual([
      true,
      false,
      false,
    ]);
  });
  it("AC-H44 · PD2-C03 · ProcessDefInputSchema nhận def có stage tool", () => {
    const s = schemaOf(ha, "ProcessDefInputSchema");
    expect(ok(s, defInput({ stages: [agentDef(), toolStage()] }))).toBe(true);
  });
});

describe("PD2-C04 · part branch [plan-contract §6]", () => {
  it("AC-H45 · PD2-C04 · RoomProcessPartSchema branch {process_run_id, stage_idx, to_step, rule}; rule 0/11 lỗi", () => {
    const s = schemaOf(chat, "RoomProcessPartSchema");
    const p = (rule: number) => ({
      kind: "branch",
      process_run_id: X(51),
      stage_idx: 1,
      to_step: 3,
      rule,
    });
    expect([ok(s, p(1)), ok(s, p(10)), ok(s, p(0)), ok(s, p(11))]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

const ITEM = {
  workflow_id: X(61),
  key: "xuat-hoa-don",
  name: "Xuất hoá đơn",
  side_effect: false,
  enabled: true,
  on: true,
  granted_at: "2026-10-18T02:00:00.000Z",
  granted_by: X(62),
};
describe("PD2-C05 · công tắc tool + catalog editor [plan-contract §6, plan-addendum A1]", () => {
  it("AC-A15 · PD2-C05 · TenantWorkflowToolSchema ok; list ≤ 200; PutSchema strict {} (thừa trường ⇒ lỗi)", () => {
    expect(ok(wtSchema("TenantWorkflowToolSchema"), ITEM)).toBe(true);
    expect(
      ok(wtSchema("TenantWorkflowToolSchema"), {
        ...ITEM,
        on: false,
        granted_at: null,
        granted_by: null,
      }),
    ).toBe(true);
    const list = wtSchema("TenantWorkflowToolListSchema");
    expect([
      ok(list, { items: Array.from({ length: 200 }, () => ITEM) }),
      ok(list, { items: Array.from({ length: 201 }, () => ITEM) }),
    ]).toEqual([true, false]);
    const put = wtSchema("TenantWorkflowToolPutSchema");
    expect([ok(put, {}), ok(put, { on: true })]).toEqual([true, false]);
  });
  it("AC-H47 · PD2-C05 · ProcessToolItemSchema: params 50 ok / 51 lỗi; options chỉ khi select; description 400 ok / 401 lỗi; editor context tools optional", () => {
    const s = schemaOf(ha, "ProcessToolItemSchema");
    const item = (o: Record<string, unknown> = {}) => ({
      key: "xuat-hoa-don",
      name: "Xuất hoá đơn",
      description: "",
      side_effect: false,
      params: [{ name: "tong_tien", type: "number", required: true }],
      ...o,
    });
    const ps = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `p${i}`, type: "text", required: false }));
    expect([
      ok(s, item()),
      ok(s, item({ params: ps(50) })),
      ok(s, item({ params: ps(51) })),
    ]).toEqual([true, true, false]);
    const sel = { name: "loai", type: "select", required: true, options: ["a", "b"] };
    expect([
      ok(s, item({ params: [sel] })),
      ok(s, item({ params: [{ ...sel, type: "text" }] })),
      ok(s, item({ description: "x".repeat(400) })),
      ok(s, item({ description: "x".repeat(401) })),
    ]).toEqual([true, false, true, false]);
    const ctx = schemaOf(ha, "ProcessEditorContextSchema");
    expect(typeof ctx.shape?.tools?.safeParse).toBe("function");
    expect(ctx.shape.tools.safeParse(undefined).success).toBe(true);
  });
});

describe("PD2-U20 · toggleChange admin [plan-d2 §6]", () => {
  it("AC-A15 · PD2-U20 · (null,on)=insert; (revoked,on)=reactivate; (active,on)=none; (active,off)=revoke; (revoked,off)=none; (null,off)=none", async () => {
    const f = await adminToolsFn("toggleChange");
    const R = { revokedAt: new Date("2026-10-01T00:00:00Z") };
    const A = { revokedAt: null };
    expect([
      f(null, "on"),
      f(R, "on"),
      f(A, "on"),
      f(A, "off"),
      f(R, "off"),
      f(null, "off"),
    ]).toEqual(["insert", "reactivate", "none", "revoke", "none", "none"]);
  });
});
