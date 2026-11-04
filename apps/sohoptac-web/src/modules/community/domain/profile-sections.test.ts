// CR-110 · COM-FR-35..37 · registry section + hiển thị theo vai; mock media/uy tín.
import { describe, expect, it } from "bun:test";
import { createMockApi } from "../adapters/mock";
import { friendsStat, hasReputation, resolveSection, visibleSections } from "./profile-sections";

const host = { isHostViewer: true };
const partner = { isHostViewer: false };
const ids = (c: { isHostViewer: boolean }) => visibleSections(c).map((s) => s.id);

describe("registry hồ sơ", () => {
  it("chủ quản 4 tab, đối tác 3 tab không có Đối tác", () => {
    expect(ids(host)).toEqual(["about", "posts", "partners", "files"]);
    expect(ids(partner)).toEqual(["about", "posts", "files"]);
  });
  it("section lạ hoặc không được xem về Bài đăng; files mở đúng mục", () => {
    expect(resolveSection("files", partner)).toBe("files");
    expect(resolveSection("partners", partner)).toBe("posts");
    expect(resolveSection("partners", host)).toBe("partners");
    expect(resolveSection("zzz", host)).toBe("posts");
    expect(resolveSection(undefined, host)).toBe("posts");
  });
  it("đối tác không thấy số Bạn bè; cột uy tín chỉ khi có reputation", () => {
    expect(friendsStat(4, partner)).toBeUndefined();
    expect(friendsStat(4, host)).toBe(4);
    expect(hasReputation([{ id: "a", name: "A", labels: [], cats: [] }])).toBe(false);
    expect(
      hasReputation([
        { id: "a", name: "A", labels: [], cats: [], reputation: { band: "new", score: null } },
      ]),
    ).toBe(true);
  });
});

describe("mock hồ sơ", () => {
  it("đối tác: hồ sơ không có friends/shtUrl; /partners?rep=1 không có uy tín", async () => {
    const { api, setPersona } = createMockApi();
    setPersona("tp");
    const p = await api.getProfile();
    expect(p.stats.friends).toBeUndefined();
    expect(p.shtUrl).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("Sổ Hợp Tác");
    expect((await api.listPartners({ rep: true })).every((o) => o.reputation === undefined)).toBe(
      true,
    );
  });
  it("chủ quản có quyền contracts: rep=1 có uy tín, không rep=1 thì không", async () => {
    const { api, setPersona } = createMockApi();
    setPersona("an");
    expect((await api.listPartners()).some((o) => o.reputation)).toBe(false);
    expect((await api.listPartners({ rep: true })).some((o) => o.reputation)).toBe(true);
  });
  it("media phân trang con trỏ, không trùng", async () => {
    const { api, setPersona } = createMockApi();
    setPersona("an");
    const all = await api.getProfileMedia("host", { limit: 60 });
    expect(all.items.length).toBeGreaterThan(1);
    const first = await api.getProfileMedia("host", { limit: 1 });
    expect(first.nextCursor).toBeDefined();
    const second = await api.getProfileMedia("host", { limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});
