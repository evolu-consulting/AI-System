// CR-118 · cr118-app-config · bảng bước chỉ đọc của quy trình mặc định (từ `slot_body` thư viện).
import { describe, expect, test } from "bun:test";
import { rowsFromSlotBody } from "./flow-view";

const review = {
  kind: "review",
  key: "s1",
  name: "Trưởng phòng duyệt",
  department_group_key: "phap-che",
  head_only: true,
  due_h: 72,
  remind_every_h: 24,
  escalate_group_key: null,
  exclude_starter: false,
  when: { op: "and", conds: [{ field: "total_value", op: "gt", value: 500_000_000 }] },
};
const esign = {
  kind: "esign",
  key: "s2",
  name: "Ký số",
  company_signer: { mode: "owner" },
  partner_signs: true,
  order: "company_first",
  provider: null,
  due_h: 48,
  remind_every_h: null,
  escalate_group_key: null,
};
const dify = {
  kind: "dify",
  key: "s3",
  name: "Trích xuất",
  workflow_key: "extract",
  after: "auto",
};

describe("rowsFromSlotBody", () => {
  test("dạng bọc {steps}: dòng bước đủ người làm, hạn/nhắc và điều kiện bằng lời", () => {
    const rows = rowsFromSlotBody({ steps: [review, esign, dify] });
    expect(rows?.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(rows?.[0]).toMatchObject({
      kind: "review",
      who: { type: "group", key: "phap-che", headOnly: true },
      timing: { dueH: 72, remindH: 24 },
      condition: "Chỉ khi giá trị > 500 tr",
    });
    expect(rows?.[1]).toMatchObject({
      who: { type: "owner" },
      timing: { dueH: 48, remindH: null },
      condition: null,
    });
    expect(rows?.[2]).toMatchObject({ who: { type: "workflow", key: "extract" }, timing: null });
  });
  test("mảng trần cũng đọc được, dạng lạ hoặc loại bước lạ ⇒ null (UI mời mở trình soạn)", () => {
    expect(rowsFromSlotBody([review])).toHaveLength(1);
    expect(rowsFromSlotBody({ nodes: [] })).toBeNull();
    expect(rowsFromSlotBody({ steps: [{ kind: "other" }] })).toBeNull();
    expect(rowsFromSlotBody(undefined)).toBeNull();
  });
});
