import { describe, expect, it } from "bun:test";
import { limitIssues, textIssues } from "./check-shared-limits.rules";

const run = (files: Record<string, string>) => limitIssues(new Map(Object.entries(files)));
const DECL = "export const REMIND_EVERY_H = { min: 4, max: 168 } as const;";

describe("check:shared-limits", () => {
  it("khai lại hằng có test parity cùng app ⇒ sạch", () => {
    expect(
      run({
        "apps/a/src/limits.ts": DECL,
        "apps/a/src/limits.test.ts": 'import * as C from "@ai/contracts/chat"; C.REMIND_EVERY_H',
      }),
    ).toEqual([]);
  });
  it("khai lại hằng không có parity (hoặc parity ở app khác) ⇒ đỏ", () => {
    const r = run({
      "apps/a/src/limits.ts": DECL,
      "apps/b/src/limits.test.ts": 'import * as C from "@ai/contracts/chat"; C.REMIND_EVERY_H',
    });
    expect(r.map((i) => `${i.file}:${i.line}`)).toEqual(["apps/a/src/limits.ts:1"]);
  });
  it("số cứng của hằng trong tsx ⇒ đỏ; chú thích và test thì bỏ qua", () => {
    const r = run({
      "apps/a/src/X.tsx": "<input max={168} />\n// max={168}\n<input max={ESC.max} />",
      "apps/a/src/Y.test.tsx": "<input max={168} />",
      "apps/a/src/Z.ts": "const o = { max: 2160 };",
    });
    expect(r.map((i) => `${i.file}:${i.line}`)).toEqual([
      "apps/a/src/X.tsx:1",
      "apps/a/src/Z.ts:1",
    ]);
  });
  it("chữ locale ghi cứng khoảng nhắc ⇒ đỏ; nội suy thì sạch", () => {
    const r = textIssues([
      { file: "a.vi.json", key: "k1", value: "Từ 4 đến 168 giờ." },
      { file: "a.en.json", key: "k2", value: "4-168 hours" },
      { file: "a.vi.json", key: "k3", value: "Từ {{min}} đến {{max}} giờ." },
      { file: "a.vi.json", key: "k4", value: "Từ 4 đến 2.160 giờ." },
    ]);
    expect(r.map((i) => i.msg.split(":")[0])).toEqual(["k1", "k2"]);
  });
});
