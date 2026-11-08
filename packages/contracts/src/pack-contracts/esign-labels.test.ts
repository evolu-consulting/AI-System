// CR-125 · c1 · MỘT mô hình trạng thái ký số: thẻ duyệt và khối Ký số quy về cùng nhóm khoá i18n.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esignLabelKey } from "./esign-labels";

const flat = (o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(o as object)) {
    if (typeof v === "string") out[`${p}${k}`] = v;
    else flat(v, `${p}${k}.`, out);
  }
  return out;
};
const vi = (f: string) =>
  flat(
    JSON.parse(readFileSync(join(import.meta.dir, "../../../i18n/locales/contracts", f), "utf8")),
  );

describe("esignLabelKey", () => {
  test("cùng một việc ⇒ cùng một khoá, dù đến từ phong bì hay dòng ký số của thẻ", () => {
    expect(esignLabelKey("sent")).toBe(esignLabelKey("delivered"));
    expect(esignLabelKey("sent")).toBe("contracts.esign.pending");
    expect(esignLabelKey("completed")).toBe("contracts.esign.signed");
  });
  test("mọi trạng thái (phong bì + dòng thẻ) có nhãn trong i18n; không còn nhãn 'Đã ký xong'", () => {
    const all = { ...vi("esign.vi.json"), ...vi("esignflow.vi.json") };
    for (const s of [
      "sent",
      "delivered",
      "completed",
      "declined",
      "voided",
      "sending",
      "pending",
      "needs_decision",
    ])
      expect(all[esignLabelKey(s)], s).toBeTruthy();
    expect(Object.values(all)).not.toContain("Đã ký xong");
  });
  test("trạng thái lạ ⇒ nhãn chờ ký an toàn", () => {
    expect(esignLabelKey("???")).toBe("contracts.esign.pending");
  });
});
