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
});

describe("libraryFlowOf", () => {
  // Lỗi sản phẩm: trình xem Thư viện (tenant_admin) và trình sửa của platform sập "Cannot read properties of undefined (reading 'map')"
  // vì stage biên dịch từ khe (slot + trigger) không có `sources` / `must_know` / `autofix` (Hub trả stage THÔ, chưa qua zod).
  test("stage biên dịch từ khe, thiếu sources/must_know/autofix ⇒ vẫn dựng được bản nháp", () => {
    const raw = {
      key: "s0",
      name: "Kiểm tra hợp đồng",
      step: 0,
      slot: {
        key: "level1",
        kind: "review",
        name: "Kiểm tra hợp đồng",
        when: null,
        due_h: 72,
        head_only: false,
        remind_every_h: null,
        exclude_starter: false,
        escalate_group_id: null,
        escalate_group_key: null,
        department_group_id: null,
        department_group_key: "contracts-editor",
      },
      after: { kind: "review", branch: [], escalate: null, group_id: null, back_to_steps: [] },
      output: { fields: [], filename: "s0.md", template: "x", required_sections: ["x"] },
      answerer: { kind: "starter" },
      executor: { kind: "tool", tool_key: "contracts-route", args: {} },
      timeout_s: 60,
      instruction: "",
      real_action: false,
      token_budget: null,
    };
    const f = libraryFlowOf({
      name: "Duyệt HĐ",
      stages: [raw],
      trigger: { event: "contract.submitted" },
      app: "contracts",
    });
    expect(f?.draft.stages).toHaveLength(1);
    expect(f?.draft.stages[0]?.sources).toEqual([]);
    expect(f?.draft.stages[0]?.mustKnow).toBe("");
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
