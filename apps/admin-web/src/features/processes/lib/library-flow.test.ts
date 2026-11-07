// CR-122 · xem chỉ đọc flow Thư viện + lỗi chặn Lưu phải nói ra.
import { describe, expect, test } from "bun:test";
import { libraryFlowOf } from "./library-flow";
import { blockedInfo } from "./save-blocked";

describe("libraryFlowOf", () => {
  test("def khe cũ (không trigger) ⇒ null", () => {
    expect(libraryFlowOf({ name: "x", stages: [], slot_body: {} } as never)).toBeNull();
  });
  test("flow có trigger + app ⇒ bản nháp chỉ đọc", () => {
    const f = libraryFlowOf({
      name: "Duyệt",
      stages: [],
      trigger: { event: "contract.submitted" },
      app: "contracts",
    });
    expect(f?.app).toBe("contracts");
    expect(f?.trigger.event).toBe("contract.submitted");
    expect(f?.draft.stages).toEqual([]);
  });
  test("thiếu app ⇒ null (không vẽ nửa vời)", () => {
    expect(libraryFlowOf({ name: "x", stages: [], trigger: { event: "e" } })).toBeNull();
  });
});

describe("blockedInfo", () => {
  const stages = [{ name: "Duyệt" }, { name: "" }, { name: "Ký số" }];
  test("không lỗi ⇒ null", () => {
    expect(blockedInfo({}, stages)).toBeNull();
  });
  test("lỗi bước đứng trước nhất, kèm tên bước + khoá câu sửa", () => {
    const r = blockedInfo({ "stages.2.executor.args.x": "k2", "stages.0.name": "k0" }, stages);
    expect(r).toEqual({ stepName: "Duyệt", reasonKey: "k0", index: 0 });
  });
  test("tên bước rỗng ⇒ số bước; lỗi chung ⇒ không tên bước", () => {
    expect(blockedInfo({ "stages.1.executor": "k" }, stages)?.stepName).toBe("2");
    expect(blockedInfo({ name: "kn" }, stages)).toEqual({
      stepName: null,
      reasonKey: "kn",
      index: null,
    });
  });
});
