import { describe, expect, it } from "bun:test";
import { buildSettingsNav, canEditCompany, findSection, shtPath } from "./settings-sections";

const ids = (v: Parameters<typeof buildSettingsNav>[0]) => buildSettingsNav(v).map((g) => g.id);
const sht = { caps: { contracts: true }, contractsUrl: "https://sht.example/" };
const none = { caps: { contracts: false }, contractsUrl: null };

describe("buildSettingsNav (COM-FR-38..42)", () => {
  it("Admin có quyền contracts: Cá nhân + Công ty + SHT với 5 mục deep-link, flow chỉ xem", () => {
    const g = buildSettingsNav({ role: "host_admin", ...sht });
    expect(g.map((x) => x.id)).toEqual(["personal", "company", "sht"]);
    const s = g[2]?.sections ?? [];
    expect(s.map((x) => x.sec)).toEqual(["co", "rep", "biz", "scout", "flow"]);
    expect(s.find((x) => x.id === "flow")?.readonly).toBe(true);
    expect(g[1]?.companyWide && g[2]?.companyWide && !g[0]?.companyWide).toBe(true);
  });
  it("đối tác: chỉ Cá nhân (không Công ty, không SHT) dù server lỡ cấp caps", () => {
    expect(ids({ role: "partner", ...none })).toEqual(["personal"]);
    expect(ids({ role: "partner", caps: { contracts: true }, contractsUrl: null })).toEqual([
      "personal",
    ]);
  });
  it("chủ quản thiếu caps hoặc contractsUrl: không nhóm SHT", () => {
    expect(ids({ role: "host_member", ...none })).toEqual(["personal", "company"]);
    expect(ids({ role: "host_admin", caps: { contracts: true }, contractsUrl: null })).toEqual([
      "personal",
      "company",
    ]);
  });
  it("chỉ host_admin sửa Công ty; findSection + shtPath", () => {
    expect(canEditCompany("host_admin")).toBe(true);
    expect(canEditCompany("host_member")).toBe(false);
    expect(findSection(buildSettingsNav({ role: "partner", ...none }), "rep")).toBeNull();
    expect(shtPath("scout")).toBe("/settings?sec=scout");
  });
});
