// HUB-FR-68 · PC2-R10 · FC2 · hồi quy React 19: Radix <select> ẩn echo "" khi option khoá vừa tạo chưa đăng ký ⇒ không được xoá lựa chọn.
import { expect, test } from "bun:test";
import { CRED_NEW, CRED_NONE, credentialChoice } from "./credential-choice";

test("giá trị rỗng từ select ẩn của Radix bị bỏ qua (không reset về 'Không')", () => {
  expect(credentialChoice("")).toEqual({ kind: "ignore" });
});

test("NONE ⇒ id rỗng; NEW ⇒ mở dialog; uuid ⇒ chọn khoá", () => {
  expect(credentialChoice(CRED_NONE)).toEqual({ kind: "set", id: "" });
  expect(credentialChoice(CRED_NEW)).toEqual({ kind: "new" });
  expect(credentialChoice("0b1f6c1e-0000-4000-8000-000000000001")).toEqual({
    kind: "set",
    id: "0b1f6c1e-0000-4000-8000-000000000001",
  });
});
