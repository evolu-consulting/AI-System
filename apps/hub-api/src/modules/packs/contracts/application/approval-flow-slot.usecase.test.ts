// CR-118 · UW-FR-11/14 · adapter khe `contracts.approval` + runtime kit: hành động đi đúng use case thẻ duyệt, task cũ ⇒ 409,
// đầu vào lạ ⇒ 422, đối tác ⇒ forbidden (không gọi gói), khe lạ ⇒ no_slot; summary: số SQL CỐ ĐỊNH (1 câu) cho lô 1 và 100 ref.
import { describe, expect, test } from "bun:test";
import type { Tx } from "@ai/db";
import { flowRuntime, flowRuntimeOn } from "../../kit/application/flow.ports";
import { approvalFlowSummaryRepo } from "../adapters/approval-flow-summary.repo";
import type { ApprovalAction } from "./approval.usecase";
import { approvalFlowSlot } from "./approval-flow-slot.usecase";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WHO = { tenantId: U(70), userId: U(71) };
const CARD = {
  run_id: U(1),
  run_status: "waiting_review",
  step: "level1" as const,
  task_id: U(9),
  can_act: true,
  feedback: null,
  block_reason: null,
  finalizes_on_approve: false,
  mode: "engine" as const,
  steps: [],
};

function fake() {
  const acts: ApprovalAction[] = [];
  const rowsCalls: string[][] = [];
  const slot = approvalFlowSlot({
    get: async (_w, id) => (id === U(2) ? (CARD as never) : null),
    act: async (_w, _id, b) => {
      acts.push(b);
      return CARD as never;
    },
    rows: async (_w, ids) => {
      rowsCalls.push([...ids]);
      return ids.map((ref) => ({
        ref,
        status: "level1",
        mode: "engine",
        flow_version: 2,
        attention: false,
      }));
    },
  });
  return { slot, acts, rowsCalls, rt: flowRuntime("contracts", [slot]) };
}

describe("CR-118 · approvalFlowSlot", () => {
  test("act: đúng task ⇒ gọi actApproval y nguyên + trả view (snapshot từ hàng)", async () => {
    const f = fake();
    const out = await f.slot.act(WHO, U(2), U(9), "reject", { feedback: "Sai" });
    expect(f.acts).toEqual([{ action: "reject", feedback: "Sai" }]);
    expect(out).toMatchObject({ view: { ref: U(2), run: { snapshot_version: 2 } } });
  });
  test("act: task cũ ⇒ 409 APPROVAL_NOT_OPEN, không gọi use case", async () => {
    const f = fake();
    expect(await f.slot.act(WHO, U(2), U(8), "approve", {})).toEqual({
      error: { code: "APPROVAL_NOT_OPEN", status: 409 },
    });
    expect(f.acts).toEqual([]);
  });
  test("act: hành động lạ / values / extension sai ⇒ 422; ref không phải uuid ⇒ not_found", async () => {
    const f = fake();
    expect(await f.slot.act(WHO, U(2), U(9), "drop", {})).toMatchObject({ error: { status: 422 } });
    expect(await f.slot.act(WHO, U(2), U(9), "approve", { values: { a: 1 } })).toMatchObject({
      error: { status: 422 },
    });
    expect(await f.slot.act(WHO, U(2), U(9), "reject", { extension: [] })).toMatchObject({
      error: { status: 422 },
    });
    expect(await f.slot.act(WHO, "x", U(9), "approve", {})).toBe("not_found");
    expect(await f.slot.view(WHO, "x")).toBeNull();
    expect(f.acts).toEqual([]);
  });
  test("runtime: đối tác ⇒ forbidden (gói không được gọi); khe lạ ⇒ no_slot", async () => {
    const f = fake();
    const ext = { ...WHO, userKind: "external" as const, extOrgId: U(3) };
    expect(await f.rt.view(ext, "contracts.approval", U(2))).toBe("forbidden");
    expect(await f.rt.act(ext, "contracts.approval", U(2), U(9), "approve", {})).toBe("forbidden");
    expect(await f.rt.summary(ext, "contracts.approval", [U(2)])).toBe("forbidden");
    expect(await f.rt.view(WHO, "community.quote", U(2))).toBe("no_slot");
    expect(f.acts).toEqual([]);
    expect(f.rowsCalls).toEqual([]);
  });
  test("summary: MỘT lần đọc cho cả lô 100, ref không phải uuid bị bỏ", async () => {
    const f = fake();
    const refs = Array.from({ length: 100 }, (_, i) => U(1000 + i));
    const items = await f.slot.summary(WHO, [...refs.slice(0, 99), "nope"]);
    expect(f.rowsCalls.length).toBe(1);
    expect(f.rowsCalls[0]?.length).toBe(99);
    expect(items.length).toBe(99);
  });
  test("repo summary: số câu SQL cố định (1) cho lô 1 và lô 100; lô rỗng 0", async () => {
    const count = async (n: number) => {
      let calls = 0;
      const tx = { execute: async () => (calls++, []) } as unknown as Tx;
      await approvalFlowSummaryRepo(tx, U(70)).rows(Array.from({ length: n }, (_, i) => U(i)));
      return calls;
    };
    expect([await count(0), await count(1), await count(100)]).toEqual([0, 1, 1]);
  });
  test("cờ: mặc định TẮT; seam thắng env", () => {
    expect(flowRuntimeOn(undefined, undefined)).toBe(false);
    expect(flowRuntimeOn(undefined, "on")).toBe(true);
    expect(flowRuntimeOn(false, "on")).toBe(false);
  });
});
