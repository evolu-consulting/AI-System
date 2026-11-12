// CR-113 (review #3) · preview `GET /approval-flow` (`ownerView`) khớp `compileDef`: (a) nhóm chuyển cấp đặt tường minh mà Group
// đã xoá ⇒ lỗi cấu hình (compileDef ném `approval-flow-group-missing`), KHÔNG hiện mặc định; (b) bước chỉ có người cụ thể ⇒ cùng
// một thứ tự Toàn quyền (`escalateOrder`, owner trước) cho Group gắn task + đích chuyển cấp mặc định, không phụ thuộc thứ tự Map.

import { describe, expect, it } from "bun:test";
import { PACK_OWNER_GROUP_KEY } from "../domain/approval-def.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import { escalateOrder } from "../domain/approval-owner.rules";
import { compileDef } from "../testing/approval-slot/approval-compile";
import { ownerView } from "./approval-flow.usecase";

const G = {
  kt: "00000000-0000-4000-8000-0000000000b1",
  own: "00000000-0000-4000-8000-0000000000b2",
  l2: "00000000-0000-4000-8000-0000000000b3",
};
const NAMES = new Map([
  [G.kt, "Kế toán"],
  [G.own, "Toàn quyền"],
  [G.l2, "Giám đốc"],
]);
const U = "00000000-0000-4000-8000-0000000000c1";

describe("CR-113 · ownerView khớp compileDef", () => {
  it("(a) escalate_group_key trỏ Group đã xoá ⇒ escalate_group_missing, không rơi về mặc định Toàn quyền", () => {
    const ids = new Map([
      ["ke-toan", G.kt],
      [PACK_OWNER_GROUP_KEY, G.own],
    ]);
    const v = ownerView(ids, NAMES, "lvl2");
    expect(
      v.escalate({ due_h: 24, department_group_key: "ke-toan", escalate_group_key: "da-xoa" }),
    ).toEqual({ escalate_default: false, escalate_group_missing: true });
    // compileDef cùng tình huống (id Group xoá không còn ở tenant) ⇒ ném
    const step = {
      kind: "review",
      key: "kt",
      name: "kt",
      department_group_id: G.kt,
      head_only: false,
      due_h: 24,
      remind_every_h: null,
      escalate_group_id: "00000000-0000-4000-8000-0000000000ff",
      exclude_starter: false,
      when: null,
    } as FlowStep;
    expect(() => compileDef({ steps: [step] }, new Set([G.kt, G.own]))).toThrow(
      "approval-flow-group-missing",
    );
  });

  it("(b) bước chỉ có người cụ thể: thứ tự xác định (Map đảo vẫn vậy) ⇒ preview = compileDef", () => {
    // Map trả theo thứ tự cấp 2 trước — thứ tự của idsOf KHÔNG được quyết kết quả.
    const ids = new Map([
      ["lvl2", G.l2],
      [PACK_OWNER_GROUP_KEY, G.own],
    ]);
    const order = escalateOrder(ids, "lvl2");
    expect(order).toEqual([G.own, G.l2]);
    const v = ownerView(ids, NAMES, "lvl2");
    expect(v.name).toBe("Toàn quyền");
    const pv = v.escalate({ due_h: 48, department_group_key: null, approver_user_id: U });
    const step = {
      kind: "review",
      key: "u",
      name: "u",
      department_group_id: null,
      approver_user_id: U,
      head_only: false,
      due_h: 48,
      remind_every_h: null,
      escalate_group_id: null,
      exclude_starter: false,
      when: null,
    } as FlowStep;
    const def = compileDef({ steps: [step] }, new Set(order), new Map(), order, order);
    const after = (def.stages[0] as unknown as { after: Record<string, unknown> }).after;
    // Group gắn task = Toàn quyền đầu (owner); chuyển cấp mặc định = Toàn quyền kế (cấp 2) — preview hiện đúng tên đó.
    expect({ group: after.group_id, esc: after.escalate }).toEqual({
      group: G.own,
      esc: { after_h: 48, group_id: G.l2 },
    });
    expect(pv).toEqual({ escalate_group_name: "Giám đốc", escalate_default: true });
  });
});
