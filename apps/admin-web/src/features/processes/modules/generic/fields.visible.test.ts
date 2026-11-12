// CR-127 · U2b · ô lý do / hạn ký chỉ hiện khi bật «Đề nghị ký cùng lúc».
import { describe, expect, test } from "bun:test";
import { configPortOf } from "../panel-registry";
import { fieldsOf, visibleFields } from "./fields";

const fields = fieldsOf(
  configPortOf("contracts.partner-send") as NonNullable<ReturnType<typeof configPortOf>>,
);
const keys = (cur: Record<string, string | number | boolean>) =>
  visibleFields(fields, cur).map((f) => f.key);

describe("visibleFields", () => {
  test("tắt ⇒ ẩn sign_reason / accept_h / sign_h", () => {
    const k = keys({});
    for (const x of ["sign_reason", "accept_h", "sign_h"]) expect(k).not.toContain(x);
    expect(k).toContain("sign_together");
  });
  test("bật ⇒ hiện đủ", () => {
    const k = keys({ sign_together: true });
    for (const x of ["sign_reason", "accept_h", "sign_h"]) expect(k).toContain(x);
  });
});
