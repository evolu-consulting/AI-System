import { describe, expect, it } from "bun:test";
import { NITI_SPEC } from "./seed-niti.data";
import { applyGuard, credLine, tenantShape } from "./seed-niti.rules";

describe("seed-niti rules", () => {
  it("tenant: chỉ chấp nhận không có hoặc trùng cả khoá lẫn tên", () => {
    const s = { tenantKey: "k", tenantName: "N" };
    expect(tenantShape(s, [])).toBe("absent");
    expect(tenantShape(s, [{ key: "k", name: "N" }])).toBe("present");
    expect(tenantShape(s, [{ key: "k", name: "Other" }])).toContain("khác hình dạng");
    expect(tenantShape(s, [{ key: "z", name: "N" }])).toContain("khác hình dạng");
  });

  it("guard: apply ngoài localhost hoặc production cần --i-know-prod, chạy thử luôn được", () => {
    const base = { iKnowProd: false, appEnv: undefined, urls: ["postgres://u@pg:5432/x"] };
    expect(applyGuard({ ...base, apply: false })).toBeNull();
    expect(applyGuard({ ...base, apply: true })).toContain("--i-know-prod");
    expect(applyGuard({ ...base, apply: true, iKnowProd: true })).toBeNull();
    expect(applyGuard({ ...base, apply: true, urls: ["postgres://u@localhost/x"] })).toBeNull();
    expect(
      applyGuard({
        ...base,
        apply: true,
        urls: ["postgres://u@localhost/x"],
        appEnv: "production",
      }),
    ).toContain("production");
  });

  it("dòng file mật khẩu có tab và xuống dòng", () => {
    expect(credLine("t", "u", "pw")).toBe("t\tu\tpw\n");
  });
});
