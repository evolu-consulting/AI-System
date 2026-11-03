// PK-FR-05 · D-05 · N1 plan §5 · luật thuần bật gói (khoá feature/Group, 6 cặp grant, PackState).
import { describe, expect, test } from "bun:test";
import {
  entitledFeatureKeys,
  isInstalled,
  packFeatureKeys,
  packGroupKeys,
  packState,
  roleGrantPairs,
  roleGroupRows,
} from "./packs.rules";

describe("packs.rules", () => {
  test("CR-112 · bật gói tới mức: cộng dồn, vắng ⇒ cả 3", () => {
    expect(entitledFeatureKeys("pk", "write")).toEqual(["pk-read", "pk-write"]);
    expect(entitledFeatureKeys("pk", "read")).toEqual(["pk-read"]);
    expect(entitledFeatureKeys("pk")).toEqual(["pk-read", "pk-write", "pk-admin"]);
  });
  test("PK-FR-05 · khoá feature/Group đổi `_`→`-`", () => {
    expect(packFeatureKeys("my_pk")).toEqual(["my-pk-read", "my-pk-write", "my-pk-admin"]);
    expect(packGroupKeys("my_pk")).toEqual(["my-pk-owner", "my-pk-editor", "my-pk-viewer"]);
    expect(roleGroupRows("pk").map((r) => r.name.vi)).toEqual([
      "pk – Toàn quyền",
      "pk – Nhân viên",
      "pk – Chỉ xem",
    ]);
  });
  test("friendly-groups · tên thân thiện cho contracts/knowledge, có en + mô tả", () => {
    expect(roleGroupRows("contracts").map((r) => r.name.vi)).toEqual([
      "Sổ Hợp Tác – Toàn quyền",
      "Sổ Hợp Tác – Nhân viên",
      "Sổ Hợp Tác – Chỉ xem",
    ]);
    expect(roleGroupRows("knowledge")[2]?.name).toEqual({
      vi: "Tài liệu nội bộ – Chỉ xem",
      en: "Internal Documents – View only",
    });
    expect(roleGroupRows("contracts")[1]?.description).toContain("Sổ Hợp Tác");
  });
  test("PK-AC05 · 6 cặp grant: viewer=read · editor=read+write · owner=cả ba", () => {
    const s = roleGrantPairs("pk").map((p) => `${p.grp}>${p.feat}`);
    expect(s.sort()).toEqual([
      "pk-editor>pk-read",
      "pk-editor>pk-write",
      "pk-owner>pk-admin",
      "pk-owner>pk-read",
      "pk-owner>pk-write",
      "pk-viewer>pk-read",
    ]);
  });
  test("PK-FR-05 · đã cài ⇔ đủ 3 feature", () => {
    const all = packFeatureKeys("pk").map((key) => ({ key }));
    expect(isInstalled("pk", all)).toBe(true);
    expect(isInstalled("pk", all.slice(0, 2))).toBe(false);
  });
  test("PK-FR-05 · packState map key → vai, bỏ Group lạ", () => {
    const st = packState("pk", true, [
      { id: "a", key: "pk-owner" },
      { id: "b", key: "khac" },
      { id: "c", key: "pk-viewer" },
    ]);
    expect(st).toEqual({
      key: "pk",
      enabled: true,
      groups: [
        { role: "owner", group_id: "a" },
        { role: "viewer", group_id: "c" },
      ],
    });
  });
});
