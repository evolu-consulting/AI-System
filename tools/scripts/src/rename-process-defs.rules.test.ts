// CR-120 · luật thuần đổi tên quy trình theo bước.
import { describe, expect, test } from "bun:test";
import { planRenames, RENAMES } from "./rename-process-defs.rules";

const old = (k: string, i: number) => ({ id: `id${i}`, key: k, name: "tên cũ" });

describe("rename-process-defs rules", () => {
  test("tên mới theo bước, không mã hoá ai/khi nào", () => {
    for (const r of RENAMES) {
      expect(r.name).toMatch(/^Duyệt \d cấp: /);
      expect(r.name).not.toMatch(/từ Kinh doanh|từ Ban Giám đốc|\(/);
    }
    expect(RENAMES.find((r) => r.key === "niti-mua-kd")?.name).toBe(
      "Duyệt 2 cấp: Kế toán → Giám đốc",
    );
  });

  test("kế hoạch đổi tên idempotent", () => {
    const found = RENAMES.map((r, i) => old(r.key, i)).slice(0, 3);
    const first = planRenames(found);
    expect(first.map((s) => s.state)).toEqual(["rename", "rename", "rename", "missing"]);
    const applied = found.map((f) => ({
      ...f,
      name: RENAMES.find((r) => r.key === f.key)?.name ?? "",
    }));
    expect(planRenames(applied).map((s) => s.state)).toEqual(["same", "same", "same", "missing"]);
  });
});
