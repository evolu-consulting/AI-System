// CR-118 · cr118-form-node · unit: đối tác (user ngoài) không bao giờ làm bước form ở run gói contracts (câu 17);
// trường form đọc từ SNAPSHOT run; giá trị sai ⇒ 422 FORM_VALUES_INVALID {paths}.
import { describe, expect, test } from "bun:test";
import { assertFormActor, checkFormValues, snapFormFields } from "./form-out";
import type { Locked } from "./gates.effects";

const FIELDS = [{ key: "a", label: "A", type: "text", required: true, max_len: 5 }];
const run = (packKey: string | null): Locked =>
  ({
    packKey,
    snapshot: {
      stages: [{ executor: { kind: "form", fields: FIELDS } }, { executor: { kind: "set" } }],
    },
  }) as unknown as Locked;
const code = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  }
};

describe("CR-118 · form-out", () => {
  test("đối tác ở run gói contracts ⇒ 404; nội bộ hoặc gói khác ⇒ qua", () => {
    expect(code(() => assertFormActor(run("contracts"), { values: {}, external: true }))).toBe(
      "PROCESS_NOT_FOUND",
    );
    expect(
      code(() => assertFormActor(run("contracts"), { values: {}, external: false })),
    ).toBeNull();
    expect(
      code(() => assertFormActor(run("community"), { values: {}, external: true })),
    ).toBeNull();
    expect(code(() => assertFormActor(run(null), { values: {}, external: true }))).toBeNull();
  });
  test("trường form theo snapshot; stage không phải form ⇒ null", () => {
    expect(snapFormFields(run(null), 0)).toEqual(FIELDS as never);
    expect(snapFormFields(run(null), 1)).toBeNull();
    expect(snapFormFields(run(null), 9)).toBeNull();
  });
  test("giá trị sai ⇒ FORM_VALUES_INVALID (422) kèm paths", () => {
    try {
      checkFormValues(FIELDS as never, { a: "quá dài" });
      throw new Error("không ném");
    } catch (e) {
      const x = e as { code: string; status: number; details: unknown };
      expect([x.code, x.status, x.details]).toEqual(["FORM_VALUES_INVALID", 422, { paths: ["a"] }]);
    }
  });
});
