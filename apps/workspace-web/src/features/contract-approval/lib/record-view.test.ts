// CR-127 · U4 · M6 · hồ sơ duyệt theo quyền xem bằng chứng (BR-26).
import { describe, expect, test } from "bun:test";
import { hasChanges, recordLines, stageName } from "./record-view";

const U = "11111111-1111-4111-8111-111111111111";
const person = { id: U, display_name: "Hoa" };
const ev = (readable: boolean) => ({
  id: U,
  readable,
  note: readable ? "Đã đối chiếu" : null,
  signature_attachment_id: readable ? U : null,
  attachment_ids: readable ? [U] : [],
  by_user: person,
  on_behalf_of: { id: U, display_name: "Lan" },
  at: "2026-11-11T09:00:00Z",
});
const item = (readable: boolean) =>
  ({
    task_id: U,
    stage: "Kế toán",
    action: "approve",
    at: "2026-11-11T09:00:00Z",
    actor: person,
    feedback: null,
    evidence: ev(readable),
  }) as never;

describe("recordLines", () => {
  test("người đọc được: ý kiến + chữ ký + tệp + «thay»", () => {
    const [l] = recordLines({ items: [item(true)], can_read_evidence: true });
    expect(l).toMatchObject({
      note: "Đã đối chiếu",
      signatureId: U,
      onBehalf: "Lan",
      readable: true,
    });
    expect(l?.fileIds).toEqual([U]);
  });
  test("người chỉ xem: chỉ biết có bằng chứng, không thấy nội dung", () => {
    const [l] = recordLines({ items: [item(false)], can_read_evidence: false });
    expect(l).toMatchObject({ hasEvidence: true, readable: false, note: null, signatureId: null });
    expect(l?.fileIds).toEqual([]);
  });
});

test("hasChanges", () => {
  expect(hasChanges({ fields: [], clauses: [], return_note: null })).toBe(false);
  expect(hasChanges({ fields: [], clauses: [], return_note: "Sửa Điều 5" })).toBe(true);
});

describe("stageName (hồ sơ duyệt không lộ mã bước)", () => {
  const steps = [{ key: "truong-phong", name: "Trưởng phòng duyệt" }];
  test("mã bước tra được ⇒ tên bước", () => {
    expect(stageName("truong-phong", steps)).toBe("Trưởng phòng duyệt");
  });
  test("mã không tra được ⇒ null (không in mã); tên sẵn (có dấu/cách) giữ nguyên", () => {
    expect(stageName("truong-phong", undefined)).toBeNull();
    expect(stageName("step_2", steps)).toBeNull();
    expect(stageName("Kế toán", steps)).toBe("Kế toán");
  });
  test("recordLines dùng tên bước", () => {
    const it = { ...(item(true) as object), stage: "truong-phong" } as never;
    expect(recordLines({ items: [it], can_read_evidence: true }, steps)[0]?.stage).toBe(
      "Trưởng phòng duyệt",
    );
  });
});
