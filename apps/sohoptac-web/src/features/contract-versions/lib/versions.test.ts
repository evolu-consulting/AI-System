import { describe, expect, test } from "bun:test";
import type { ContractVersionRef } from "@ai/contracts";
import {
  canUploadUpdate,
  defaultPair,
  diffRows,
  showVersionBadge,
  supersededInfo,
  versionErrorKey,
  versionKind,
} from "./versions";

const v = (n: number, sup: string | null): ContractVersionRef => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  version_no: n,
  status: "active",
  superseded_at: sup,
  number: null,
  effective_from: null,
  effective_to: null,
  total_value: null,
});
const all = [v(1, "2026-01-01T00:00:00Z"), v(2, null), v(3, null)];

describe("versions", () => {
  test("loại dòng: đã thay / hiện hành / nháp", () => {
    expect(all.map((x) => versionKind(x, all))).toEqual(["superseded", "current", "draft"]);
    expect(versionKind(v(1, null), [v(1, null)])).toBe("current");
  });
  test("nút Tải bản cập nhật", () => {
    const base = {
      locked: true,
      superseded_at: null,
      version_no: 2,
      versions: [v(1, "x"), v(2, null)],
    };
    expect(canUploadUpdate(base)).toBe(true);
    expect(canUploadUpdate({ ...base, locked: false })).toBe(false);
    expect(canUploadUpdate({ ...base, superseded_at: "x" })).toBe(false);
    expect(canUploadUpdate({ ...base, versions: [...base.versions, v(3, null)] })).toBe(false);
  });
  test("banner bị thay + badge", () => {
    expect(
      supersededInfo({ superseded_at: null, superseded_by: null, current_id: null, versions: [] }),
    ).toBeNull();
    expect(
      supersededInfo({
        superseded_at: "x",
        superseded_by: all[1]?.id ?? null,
        current_id: "c",
        versions: all,
      }),
    ).toEqual({ byNo: 2, currentId: "c" });
    expect(showVersionBadge(1)).toBe(false);
    expect(showVersionBadge(2)).toBe(true);
  });
  test("cặp so sánh mặc định + dòng khác", () => {
    expect(defaultPair([v(1, null)])).toBeNull();
    expect(defaultPair(all)).toEqual([all[1]?.id ?? "", all[2]?.id ?? ""]);
    expect(
      diffRows([
        { key: "number", a: null, b: "HD-2" },
        { key: "total_value", a: { value: 5 }, b: 6 },
      ]),
    ).toEqual([
      { key: "number", a: "—", b: "HD-2" },
      { key: "total_value", a: "5", b: "6" },
    ]);
  });
  test("map lỗi", () => {
    expect(versionErrorKey("VERSION_DRAFT_EXISTS")).toBe("contracts.versions.err.draftExists");
    expect(versionErrorKey("CONTRACT_SUPERSEDED")).toBe("contracts.versions.err.superseded");
    expect(versionErrorKey("VERSION_NOT_ALLOWED")).toBe("contracts.versions.err.notAllowed");
    expect(versionErrorKey("CONTRACT_HAS_VERSIONS")).toBe("contracts.versions.err.hasVersions");
    expect(versionErrorKey("???")).toBe("contracts.versions.err.generic");
    expect(versionErrorKey(undefined)).toBe("contracts.versions.err.generic");
  });
});
