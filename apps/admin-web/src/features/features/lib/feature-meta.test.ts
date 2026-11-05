// CR-111 · registry feature: suy app/mức/tính năng thêm từ key, nhóm theo app đúng thứ tự.
import { describe, expect, test } from "bun:test";
import { groupByApp, isHiddenFeature, isRegistered, metaOf } from "./feature-meta";

const f = (key: string) => ({ key });

describe("metaOf", () => {
  test("key trong registry", () => {
    expect(metaOf("community-write")).toEqual({ app: "community", level: "write" });
    expect(metaOf("contracts-approval-engine")).toEqual({ app: "contracts", addon: true });
    expect(metaOf("han-muc-duyet").app).toBe("contracts");
    expect(metaOf("chat-app").app).toBe("chat");
    expect(isRegistered("core")).toBe(true);
  });
  test("key lạ có tiền tố app đã biết ⇒ suy app; mức theo hậu tố, còn lại là tính năng thêm", () => {
    expect(metaOf("knowledge-export")).toEqual({ app: "knowledge", addon: true });
    expect(metaOf("contracts-read")).toEqual({ app: "contracts", level: "read" });
  });
  test("key lạ không khớp ⇒ Khác", () => {
    expect(metaOf("ke-toan")).toEqual({ app: "other" });
    expect(metaOf("core-x")).toEqual({ app: "other" });
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
    "community-read",
    "contracts-write",
    "contracts-approval-engine",
    "bao-cao",
  ];
  const groups = groupByApp(keys.map(f));

  test("thứ tự nhóm: Cơ bản, Chat, Community, Sổ Hợp Tác, … Khác cuối; bỏ nhóm rỗng", () => {
    expect(groups.map((g) => g.app)).toEqual(["core", "chat", "community", "contracts", "other"]);
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
  test("CR-121 D-4 · feature ẩn `contracts-approval-engine` không xuất hiện ở bất kỳ nhóm nào", () => {
    expect(isHiddenFeature("contracts-approval-engine")).toBe(true);
    expect(isHiddenFeature("han-muc-duyet")).toBe(false);
    expect(groups.flatMap((g) => g.items.map((i) => i.key))).not.toContain(
      "contracts-approval-engine",
    );
  });
  test("danh sách rỗng ⇒ không nhóm", () => {
    expect(groupByApp([])).toEqual([]);
  });
});
