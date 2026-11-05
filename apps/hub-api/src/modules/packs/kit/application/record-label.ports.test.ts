// CR-121 Q-1 · unit: nhãn HĐ + registry nhãn bản ghi (thuần, không DB).
import { describe, expect, it } from "bun:test";
import { createRecordLabelRegistry } from "./record-label.ports";

describe("createRecordLabelRegistry", () => {
  it("gói chưa đăng ký hoặc ids rỗng ⇒ map rỗng, không gọi nguồn", async () => {
    let calls = 0;
    const r = createRecordLabelRegistry();
    r.register({
      pack: "p",
      labels: async () => {
        calls++;
        return new Map([["a", "A"]]);
      },
    });
    expect((await r.labelsOf("zz", "t", ["a"])).size).toBe(0);
    expect((await r.labelsOf("p", "t", [])).size).toBe(0);
    expect(calls).toBe(0);
  });
  it("gọi nguồn MỘT lần với tập id đã khử trùng; đăng ký lại cùng gói ⇒ thay", async () => {
    const seen: string[][] = [];
    const r = createRecordLabelRegistry();
    r.register({ pack: "p", labels: async () => new Map() });
    r.register({
      pack: "p",
      labels: async (_t, ids) => {
        seen.push([...ids]);
        return new Map([["a", "A"]]);
      },
    });
    expect((await r.labelsOf("p", "t", ["a", "a", "b"])).get("a")).toBe("A");
    expect(seen).toEqual([["a", "b"]]);
  });
  it("nguồn lỗi ⇒ map rỗng (nhãn chỉ để hiển thị)", async () => {
    const r = createRecordLabelRegistry();
    r.register({ pack: "p", labels: async () => Promise.reject(new Error("db")) });
    expect((await r.labelsOf("p", "t", ["a"])).size).toBe(0);
  });
});
