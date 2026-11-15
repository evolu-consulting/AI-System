// CR-169 · hộp xác nhận: không có host ⇒ false; có host ⇒ trả đúng lựa chọn.
import { describe, expect, test } from "bun:test";
import { confirmDialog, setConfirmHost } from "./confirm-bus";

describe("CR-169 · confirm-bus", () => {
  test("không host ⇒ false", async () => {
    setConfirmHost(null);
    expect(await confirmDialog({ title: "x" })).toBe(false);
  });
  test("host trả true", async () => {
    setConfirmHost((r) => r.resolve(true));
    expect(await confirmDialog({ title: "x" })).toBe(true);
    setConfirmHost(null);
  });
});
