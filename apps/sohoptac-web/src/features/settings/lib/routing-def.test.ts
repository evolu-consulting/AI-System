import { describe, expect, test } from "bun:test";
import { defDiagramState, stepsFromSlotBody } from "./routing-def";

const body = {
  steps: [
    {
      kind: "review",
      key: "a",
      name: "Duyệt",
      department_group_key: "legal",
      due_h: 24,
      remind_every_h: 8,
      when: null,
    },
    {
      kind: "esign",
      key: "b",
      name: "Ký",
      company_signer: { mode: "owner" },
      due_h: 48,
      remind_every_h: null,
    },
  ],
};

describe("routing-def (CR-118 sơ đồ quy trình đã gán)", () => {
  test("slot_body {steps} ⇒ bước canvas", () => {
    const s = stepsFromSlotBody(body);
    expect(s?.map((x) => [x.kind, x.department, x.dueH, x.remindH])).toEqual([
      ["review", "legal", 24, 8],
      ["esign", "owner", 48, null],
    ]);
  });
  test("dạng lạ / rỗng ⇒ null", () => {
    expect(stepsFromSlotBody({ x: 1 })).toBeNull();
    expect(stepsFromSlotBody({ steps: [] })).toBeNull();
    expect(stepsFromSlotBody([{ kind: "?" }])).toBeNull();
  });
  test("404 (lỗi truy vấn) ⇒ unavailable (không xem được)", () => {
    expect(defDiagramState({ enabled: true, isError: true, data: undefined })).toEqual({
      state: "unavailable",
    });
  });
  test("chưa mở ⇒ idle; đang tải ⇒ loading; có thân ⇒ ready; thân hỏng ⇒ unavailable", () => {
    expect(defDiagramState({ enabled: false, isError: false, data: undefined }).state).toBe("idle");
    expect(defDiagramState({ enabled: true, isError: false, data: undefined }).state).toBe(
      "loading",
    );
    expect(
      defDiagramState({ enabled: true, isError: false, data: { slot_body: body } }).state,
    ).toBe("ready");
    expect(
      defDiagramState({ enabled: true, isError: false, data: { slot_body: null } }).state,
    ).toBe("unavailable");
  });
});
