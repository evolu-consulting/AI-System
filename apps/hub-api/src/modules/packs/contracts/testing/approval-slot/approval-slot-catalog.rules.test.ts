// CR-121 D-0 · danh mục khe `contracts.approval` (trường điều kiện + node) và luật điều kiện mở rộng: điều kiện cũ giữ nghĩa,
// trường trống ⇒ bước vẫn chạy, nhóm lồng một cấp.
import { describe, expect, it } from "bun:test";
import { CONTRACT_DEALS, FLOW_COND_FIELDS } from "@ai/contracts/pack-contracts";
import { slotFields, slotNodes } from "../../../kit/application/slot.ports";
import {
  condHasData,
  condHolds,
  type FlowFacts,
  whenHolds,
} from "../../domain/approval-flow.rules";
import type { FlowCond, FlowWhen } from "../../domain/approval-flow.types";
import { compileSlotStages, validateSlotBody } from "./approval-slot.rules";
import { APPROVAL_SLOT_FIELDS, APPROVAL_SLOT_NODES } from "./approval-slot-catalog.rules";

const facts = (o: Partial<FlowFacts> = {}): FlowFacts => ({
  deal: "buy",
  total_value: 100_000_000,
  ...o,
});

const keyed = (key: string, extra: Record<string, unknown> = {}) => ({
  kind: "review",
  key,
  name: key,
  department_group_id: null,
  department_group_key: key === "s0" ? "ed" : "dir",
  head_only: false,
  due_h: 48,
  remind_every_h: null,
  escalate_group_id: null,
  escalate_group_key: null,
  exclude_starter: false,
  when: null,
  ...extra,
});

describe("CR-121 D-0 · SlotSpec.fields / nodes", () => {
  it("khe hợp đồng khai đủ 4 trường v1, khớp trường của FlowCond; loại HĐ = CONTRACT_DEALS", () => {
    expect(
      slotFields({ fields: APPROVAL_SLOT_FIELDS })
        .map((f) => f.key)
        .sort(),
    ).toEqual([...FLOW_COND_FIELDS].sort());
    const deal = APPROVAL_SLOT_FIELDS.find((f) => f.key === "deal");
    expect(deal?.options?.map((o) => o.value)).toEqual([...CONTRACT_DEALS]);
    for (const f of APPROVAL_SLOT_FIELDS) expect(f.label.length).toBeGreaterThan(0);
  });

  it("node = tính năng gói đã chạy (duyệt, AI, ký số, CR-121 D-6 thông báo, chờ tới); khe không khai ⇒ rỗng", () => {
    expect(slotNodes({ nodes: APPROVAL_SLOT_NODES }).map((n) => n.kind)).toEqual([
      "review",
      "dify",
      "esign",
      "notify",
      "wait_until",
    ]);
    expect(APPROVAL_SLOT_NODES.every((n) => n.icon && n.label)).toBe(true);
    expect([slotFields({}), slotNodes({})]).toEqual([[], []]);
  });

  it("thân khe có điều kiện trường mới + nhóm lồng vẫn kiểm/biên dịch được", () => {
    const when = {
      op: "or",
      conds: [
        { field: "new_partner", is: true },
        {
          op: "and",
          conds: [
            { field: "creator_department", in: ["sales"] },
            { field: "total_value", op: "ge", value: 600_000_000 },
          ],
        },
      ],
    };
    const body = { steps: [keyed("s0"), keyed("s1", { when })] };
    expect(validateSlotBody(body)).toEqual([]);
    const stages = compileSlotStages(body) as { key: string; slot?: { when?: unknown } }[];
    expect(stages.find((s) => s.key === "s1")?.slot?.when).toEqual(when);
  });
});

describe("CR-121 D-0 · điều kiện mở rộng", () => {
  it("điều kiện cũ giữ nghĩa (trống ⇒ đúng)", () => {
    const ge = { field: "total_value", op: "ge", value: 500_000_000 } as const;
    expect(condHolds(ge, facts())).toBe(false);
    expect(condHolds(ge, facts({ total_value: 600_000_000 }))).toBe(true);
    expect(condHolds(ge, facts({ total_value: null }))).toBe(true);
    const deal: FlowCond = { field: "deal", in: ["sell"] };
    expect([condHolds(deal, facts()), condHolds(deal, facts({ deal: null }))]).toEqual([
      false,
      true,
    ]);
  });

  it("phòng ban người tạo (đã gồm phòng cha) / đối tác mới, chưa có dữ liệu ⇒ đúng", () => {
    const dep: FlowCond = { field: "creator_department", in: ["sales"] };
    expect(condHolds(dep, facts({ creator_departments: ["sales-hn", "sales"] }))).toBe(true);
    expect(condHolds(dep, facts({ creator_departments: ["acc"] }))).toBe(false);
    expect([condHolds(dep, facts()), condHasData(dep, facts())]).toEqual([true, false]);
    const np = { field: "new_partner", is: true } as const;
    expect(condHolds(np, facts({ new_partner: false }))).toBe(false);
    expect(condHolds(np, facts({ new_partner: true }))).toBe(true);
    expect([condHolds(np, facts({ new_partner: null })), condHasData(np, facts())]).toEqual([
      true,
      false,
    ]);
  });

  it("nhóm lồng một cấp: A hoặc (B và C)", () => {
    const w: FlowWhen = {
      op: "or",
      conds: [
        { field: "new_partner", is: true },
        {
          op: "and",
          conds: [
            { field: "creator_department", in: ["sales"] },
            { field: "total_value", op: "ge", value: 500_000_000 },
          ],
        },
      ],
    };
    const base = { new_partner: false, creator_departments: ["sales"] };
    expect(whenHolds(w, facts({ ...base, total_value: 600_000_000 }))).toBe(true);
    expect(whenHolds(w, facts(base))).toBe(false);
    expect(whenHolds(w, facts({ ...base, new_partner: true }))).toBe(true);
  });
});
