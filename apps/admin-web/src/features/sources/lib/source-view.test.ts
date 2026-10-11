// ADM-FR-68 · PB-R21 · FS5 · test hàm trình bày nguồn: KHÔNG rò path cho tenant_admin, nhãn ghim, dung lượng.
import { describe, expect, test } from "bun:test";
import {
  filterByKey,
  formatBytes,
  isViewOnly,
  localPathOf,
  pinLabel,
  shortGitTarget,
  summarizeCheck,
  toFullConfig,
} from "./source-view";

const SHA = "a".repeat(40);
const UUID = "0198b0c0-0000-7000-8000-000000000001";

describe("localPathOf (PB-R21)", () => {
  const full = { kind: "local_path", path: "/srv/secret" } as const;
  test("platform_admin thấy path", () => {
    expect(localPathOf(full, "platform_admin")).toBe("/srv/secret");
  });
  test("tenant_admin KHÔNG thấy path dù server lỡ gửi", () => {
    expect(localPathOf(full, "tenant_admin")).toBeNull();
    expect(localPathOf(full, "member")).toBeNull();
    expect(localPathOf(full, undefined)).toBeNull();
  });
  test("bản công khai và loại khác ⇒ null", () => {
    expect(localPathOf({ kind: "local_path" }, "platform_admin")).toBeNull();
    expect(localPathOf({ kind: "library", document_id: UUID }, "platform_admin")).toBeNull();
  });
});

describe("quyền sửa", () => {
  test("isViewOnly: chỉ tenant_admin + local_path", () => {
    expect(isViewOnly("local_path", "tenant_admin")).toBe(true);
    expect(isViewOnly("local_path", "platform_admin")).toBe(false);
    expect(isViewOnly("git_remote", "tenant_admin")).toBe(false);
    expect(isViewOnly("library", "tenant_admin")).toBe(false);
  });
  test("toFullConfig: local_path công khai ⇒ null (không đủ để PUT)", () => {
    expect(toFullConfig({ kind: "local_path" })).toBeNull();
    expect(toFullConfig({ kind: "local_path", path: "/x" })).toEqual({
      kind: "local_path",
      path: "/x",
    });
    expect(toFullConfig({ kind: "git_remote", url: "https://h/x", branch: "m" })?.kind).toBe(
      "git_remote",
    );
  });
});

describe("hiển thị", () => {
  test("shortGitTarget", () => {
    expect(shortGitTarget("https://github.com/acme/docs.git", "main")).toBe(
      "github.com/acme/docs@main",
    );
    expect(shortGitTarget("không-url", "x")).toBe("không-url@x");
  });
  test("pinLabel: git 7 ký tự, library 8 ký tự, local snapshot, null", () => {
    expect(pinLabel({ kind: "git_remote", url: "https://h/x", sha: SHA })).toEqual({
      kind: "text",
      value: "aaaaaaa",
    });
    expect(pinLabel({ kind: "library", document_id: UUID, version: UUID })).toEqual({
      kind: "text",
      value: "0198b0c0",
    });
    expect(pinLabel({ kind: "local_path", snapshot_id: UUID })).toEqual({ kind: "snapshot" });
    expect(pinLabel(null)).toBeNull();
  });
  test("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
  test("summarizeCheck theo loại pin", () => {
    const git = summarizeCheck(
      { pin: { kind: "git_remote", url: "https://h/x", sha: SHA }, files: 12, bytes: 2048 },
      "main",
    );
    expect(git).toEqual({
      key: "check.okGit",
      params: { branch: "main", sha: "aaaaaaa", files: 12, size: "2 KB" },
    });
    const local = summarizeCheck(
      { pin: { kind: "local_path", snapshot_id: UUID }, files: 3, bytes: 10 },
      undefined,
    );
    expect(local.key).toBe("check.okLocal");
  });
  test("filterByKey: không phân biệt hoa thường, rỗng ⇒ giữ nguyên", () => {
    const rows = [{ key: "docs-a" }, { key: "repo" }] as never[];
    expect(filterByKey(rows, " DOCS ")).toHaveLength(1);
    expect(filterByKey(rows, "")).toHaveLength(2);
  });
});
