// CR-118 · COM-FR-31 (MODIFIED) · mapLegacyHash: hash cũ → đường dẫn chuẩn /community/*.
import { describe, expect, it } from "bun:test";
import { mapLegacyHash } from "./legacy-hash";
import { parsePath } from "./route";

describe("mapLegacyHash", () => {
  it("#/feed và #/settings ánh xạ về /community và ?settings=1", () => {
    expect(mapLegacyHash("#/feed")).toBe("/community");
    expect(mapLegacyHash("#/settings")).toBe("/community?settings=1");
  });
  it("#/profile[/o[/s]] → /community/profile[/o[/s]]; section không orgId bị bỏ", () => {
    expect(mapLegacyHash("#/profile")).toBe("/community/profile");
    expect(mapLegacyHash("#/profile/abc")).toBe("/community/profile/abc");
    expect(mapLegacyHash("#/profile/abc/files")).toBe("/community/profile/abc/files");
    expect(mapLegacyHash("#/profile//files")).toBe("/community/profile");
  });
  it("rỗng / không phải #/… ⇒ null; tên lạ ⇒ Bảng tin", () => {
    expect(mapLegacyHash("")).toBeNull();
    expect(mapLegacyHash("#")).toBeNull();
    expect(mapLegacyHash("#section")).toBeNull();
    expect(mapLegacyHash("#/gì-đó-lạ")).toBe("/community");
  });
  it("kết quả đọc lại được bằng parsePath", () => {
    const [path = ""] = (mapLegacyHash("#/profile/abc/files") ?? "").split("?");
    expect(parsePath(path).route).toEqual({ name: "profile", orgId: "abc", section: "files" });
    const [p2 = ""] = (mapLegacyHash("#/settings") ?? "").split("?");
    expect(parsePath(p2)).toEqual({ route: { name: "feed" } });
  });
});
