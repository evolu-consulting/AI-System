// CR-121 D-6 · bước Thông báo / Chờ tới của khe `contracts.approval`: kiểm, dịch ⇒ stage engine, dựng lại từ stages, danh mục node.
import { describe, expect, it } from "bun:test";
import { compileDef, routeNext, validateFlow } from "./approval-flow.rules";
import type { FlowStep } from "./approval-flow.types";
import { notifyDefInputs, notifyRunInputs } from "./approval-flow-notify.rules";
import { fromStages, validateApprovalBody } from "./approval-flow-stages.rules";
import { compileSlotStages } from "./approval-slot.rules";
import { APPROVAL_SLOT_NODES } from "./approval-slot-catalog.rules";

const G = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const review = (key: string, when: unknown = null): FlowStep =>
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
const notify = (o: Partial<Extract<FlowStep, { kind: "notify" }>> = {}): FlowStep => ({
  kind: "notify",
  key: "bao",
  name: "Báo phụ trách",
  to: { creator: true, owner: true, group_key: "giam-doc" },
  channels: ["email"],
  title: "HĐ {ma_hd} — {ten_hd}",
  body: "Giá trị {gia_tri}",
  ...o,
});
const wait: FlowStep = {
  kind: "wait_until",
  key: "cho",
  name: "Chờ tới",
  from: "end_date",
  offset_days: -3,
  time: "09:00",
};

describe("CR-121 D-6 · Thông báo / Chờ tới trong khe duyệt HĐ", () => {
  it("danh mục node của khe có Thông báo + Chờ tới", () => {
    expect(APPROVAL_SLOT_NODES.map((n) => [n.kind, n.label])).toContainEqual([
      "notify",
      "Thông báo",
    ]);
    expect(APPROVAL_SLOT_NODES.map((n) => [n.kind, n.label])).toContainEqual([
      "wait_until",
      "Chờ tới",
    ]);
  });
  it("thiếu tham số ⇒ lỗi nói cách sửa (mã), bước sau Thông báo không được có điều kiện", () => {
    const bad = notify({
      to: { creator: false, owner: false, group_key: null },
      channels: [],
      title: "",
    });
    const cond = { op: "and", conds: [{ field: "total_value", op: "ge", value: 1 }] };
    expect(
      validateFlow([review("a"), bad, review("b", cond), { ...wait, offset_days: 999 }]),
    ).toEqual([
      { path: "steps.1.to", rule: "NOTIFY_TO_REQUIRED" },
      { path: "steps.1.channels", rule: "NOTIFY_CHANNEL_REQUIRED" },
      { path: "steps.1.title", rule: "NOTIFY_TITLE_REQUIRED" },
      { path: "steps.2.when", rule: "AFTER_DIFY_CONDITIONAL" },
      { path: "steps.3.offset_days", rule: "WAIT_OFFSET_RANGE" },
    ]);
  });
  it("dịch ⇒ stage engine notify / wait_until (auto), biến nghiệp vụ ⇒ khoá input, def khai input HĐ", () => {
    const def = compileDef({ steps: [review("a"), notify(), wait] }, new Set([G]));
    const [, , s1, s2] = def.stages as unknown as {
      executor: Record<string, unknown>;
      after: { kind: string };
      step: number;
    }[];
    expect(s1?.executor).toEqual({
      kind: "notify",
      to: [
        { who: "starter" },
        { who: "input_user", input: "contract-owner" },
        { who: "group", group_key: "giam-doc" },
      ],
      channels: ["bell", "email"],
      title: "HĐ {contract-number} — {contract-title}",
      body: "Giá trị {contract-value}",
    });
    expect(s1?.after.kind).toBe("auto");
    expect(s2?.executor).toEqual({
      kind: "wait_until",
      from: { kind: "input", key: "contract-end-date" },
      offset_days: -3,
      time: "09:00",
    });
    const keys = def.inputs.map((i) => i.key);
    for (const k of [
      "contract_id",
      "contract-title",
      "contract-value",
      "contract-owner",
      "contract-end-date",
    ])
      expect(keys).toContain(k);
    // Thông báo luôn chạy (route không bỏ qua).
    expect(routeNext([review("a"), notify(), wait], { deal: null, total_value: null }, 0)).toBe(2);
  });
  it("khe: body có Thông báo/Chờ tới hợp lệ, compile rồi fromStages dựng lại đúng bước", () => {
    const r = (k: string) => ({
      ...review(k),
      department_group_id: null,
      department_group_key: "ke-toan",
    });
    const body = { steps: [r("a"), notify(), wait] };
    expect(validateApprovalBody(body)).toEqual([]);
    const stages = compileSlotStages(body) as Parameters<typeof fromStages>[0];
    const back = fromStages(stages);
    expect(back.ok).toBe(true);
    // Def thư viện khai sẵn input người phụ trách + ngày HĐ (gộp khi lưu nháp).
    expect(notifyDefInputs(body.steps as FlowStep[]).map((x) => [x.key, x.type])).toContainEqual([
      "contract-end-date",
      "date",
    ]);
    if (back.ok) expect(back.steps.map((s) => s.kind)).toEqual(["review", "notify", "wait_until"]);
  });
  it("input run: ngày sai dạng / trống không gửi", () => {
    const ins = notifyRunInputs({
      number: "HD-1",
      owner: null,
      endDate: "2026-12-01",
      actionDeadline: "x",
    });
    expect(ins.map((i) => i.key)).toEqual(["contract-number", "contract-end-date"]);
  });
});
