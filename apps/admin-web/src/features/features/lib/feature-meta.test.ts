// CR-111 · metadata feature: mức/tính năng thêm theo key, nhóm theo app đúng thứ tự.
// CR-121 c18 · ỨNG DỤNG đọc từ cột `app` của feature (API), không suy từ tiền tố khoá.
import { describe, expect, test } from "bun:test";
import { featOf } from "./feature-fixtures";
import { groupByApp, isRegistered, metaOf } from "./feature-meta";

describe("metaOf", () => {
  test("app lấy từ cột; mức theo hậu tố; tính năng thêm khi app có mức mà khoá không có hậu tố mức", () => {
    expect(metaOf({ key: "contracts-write", app: "contracts" })).toEqual({
      app: "contracts",
      level: "write",
    });
    // ADR-0044: «Bảng tin» là tính năng thêm đã đăng ký của Sổ Hợp Tác (không có mức riêng).
    expect(metaOf({ key: "contracts-community", app: "contracts" })).toEqual({
      app: "contracts",
      addon: true,
    });
    expect(isRegistered("contracts-community")).toBe(true);
    expect(isRegistered("community-read")).toBe(false);
    expect(metaOf({ key: "han-muc-duyet", app: "contracts" })).toEqual({
      app: "contracts",
      addon: true,
    });
    expect(metaOf({ key: "knowledge-export", app: "knowledge" })).toEqual({
      app: "knowledge",
      addon: true,
    });
    expect(metaOf({ key: "chat-app", app: "chat" })).toEqual({ app: "chat" });
    expect(isRegistered("core")).toBe(true);
  });
  test("cột thắng tiền tố: khoá `contracts-x` có app=other ⇒ Khác; khoá lạ có app=contracts ⇒ nhóm Sổ Hợp Tác", () => {
    expect(metaOf({ key: "contracts-x", app: "other" })).toEqual({ app: "other" });
    expect(metaOf({ key: "zz-sales", app: "contracts" }).app).toBe("contracts");
    expect(isRegistered("ke-toan")).toBe(false);
  });
});

describe("groupByApp", () => {
  const keys = [
    "ke-toan",
    "han-muc-duyet",
    "contracts-admin",
    "chat-app",
    "contracts-read",
    "core",
    "contracts-write",
    "bao-cao",
  ];
  const groups = groupByApp(keys.map(featOf));

  test("thứ tự nhóm: Cơ bản, Chat, Sổ Hợp Tác, … Khác cuối; bỏ nhóm rỗng", () => {
    expect(groups.map((g) => g.app)).toEqual(["core", "chat", "contracts", "other"]);
  });
  test("trong nhóm: Xem → Sửa → Quản trị → tính năng thêm (theo key)", () => {
    const contracts = groups.find((g) => g.app === "contracts");
    expect(contracts?.items.map((i) => i.key)).toEqual([
      "contracts-read",
      "contracts-write",
      "contracts-admin",
      "han-muc-duyet",
    ]);
    expect(groups.find((g) => g.app === "other")?.items.map((i) => i.key)).toEqual([
      "bao-cao",
      "ke-toan",
    ]);
  });
  test("nhóm theo cột app, không theo tiền tố", () => {
    const g = groupByApp([
      { key: "contracts-odd", app: "other" as const },
      { key: "zz-sales", app: "contracts" as const },
    ]);
    expect(g.map((x) => [x.app, x.items.map((i) => i.key)])).toEqual([
      ["contracts", ["zz-sales"]],
      ["other", ["contracts-odd"]],
    ]);
  });
  test("danh sách rỗng ⇒ không nhóm", () => {
    expect(groupByApp([])).toEqual([]);
  });
});
