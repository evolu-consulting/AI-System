// app-guide · unit luật thuần: parse nội dung gói sẵn, tìm tiếng Việt (bỏ dấu), lọc theo người gọi (admin / gói).
import { describe, expect, it } from "bun:test";
import { loadGuide } from "./guide.content";
import { getSection, parseGuideDoc, searchGuide, visibleSections } from "./guide.rules";

const all = loadGuide();
const member = { admin: false, packs: new Set<string>() };
const memberContracts = { admin: false, packs: new Set(["contracts"]) };
const admin = { admin: true, packs: new Set(["contracts"]) };

describe("app-guide · nội dung", () => {
  it("parse: mỗi mục có id duy nhất, tiêu đề, nội dung; quản trị = admin, Sổ Hợp Tác = gói contracts", () => {
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all.every((s) => s.heading && s.text.length > 20)).toBe(true);
    expect(all.filter((s) => s.audience === "admin").every((s) => s.doc.startsWith("admin"))).toBe(
      true,
    );
    expect(
      all.filter((s) => s.pack === "contracts").every((s) => s.doc.startsWith("contracts")),
    ).toBe(true);
    expect(() => parseGuideDoc("không có frontmatter\n## x\ny")).toThrow();
  });
});

describe("app-guide · tìm", () => {
  it("tạo hợp đồng + AI đọc file ⇒ mục tải file lên đứng đầu, nêu Upload hợp đồng", () => {
    const hit = searchGuide(
      all,
      memberContracts,
      "Làm sao để tạo hợp đồng mới và để AI đọc file hợp đồng?",
      3,
    );
    expect(hit[0]?.id.startsWith("contracts-contracts/")).toBe(true);
    expect(hit[0]?.text).toContain("Upload hợp đồng");
  });
  it("điểm uy tín đối tác ở đâu ⇒ mục Đối tác", () => {
    const hit = searchGuide(all, memberContracts, "Xem điểm uy tín đối tác ở đâu?", 3);
    expect(hit[0]?.doc).toBe("contracts-partners");
    expect(hit[0]?.text).toContain("Tổng quan");
  });
  it("không dấu vẫn khớp; câu chat ngoài phạm vi ⇒ rỗng", () => {
    expect(searchGuide(all, member, "tra loi tiep trong flow", 1)[0]?.doc).toBe("ai-system");
    expect(searchGuide(all, member, "zzqq xyzxyz", 3)).toEqual([]);
  });
});

describe("app-guide · lọc theo người gọi", () => {
  it("thành viên thường không thấy mục Quản trị; chưa bật gói hợp đồng thì không thấy Sổ Hợp Tác", () => {
    const m = visibleSections(all, member);
    expect(m.some((s) => s.audience === "admin")).toBe(false);
    expect(m.some((s) => s.pack === "contracts")).toBe(false);
    expect(m.some((s) => s.doc === "ai-system")).toBe(true);
    expect(visibleSections(all, memberContracts).some((s) => s.pack === "contracts")).toBe(true);
    expect(visibleSections(all, admin).some((s) => s.audience === "admin")).toBe(true);
  });
  it("tìm/lấy theo id không lộ mục bị ẩn", () => {
    const adm = all.find((s) => s.audience === "admin");
    expect(adm).toBeDefined();
    expect(getSection(all, member, adm?.id ?? "")).toBeUndefined();
    expect(getSection(all, admin, adm?.id ?? "")?.id).toBe(adm?.id);
    expect(
      searchGuide(all, member, "tạo người dùng mới users mật khẩu tạm", 5).some(
        (s) => s.audience === "admin",
      ),
    ).toBe(false);
  });
});
