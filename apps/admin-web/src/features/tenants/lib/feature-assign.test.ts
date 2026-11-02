// CR-111 · mức Tắt/Xem/Sửa/Quản trị ↔ tập key (hai chiều, kể cả bộ không chuẩn), tính năng thêm, diff lưu một lượt.
import { describe, expect, test } from "bun:test";
import {
  type AppCard,
  availableLevels,
  buildCards,
  detectLevel,
  diffEntitlements,
  entitledKeys,
  keysForLevel,
  setKey,
  setLevel,
  type TenantFeature,
} from "./feature-assign";

const feat = (key: string, entitled = false): TenantFeature => ({
  id: `id-${key}`,
  key,
  name: { vi: key },
  entitled,
});
const catalog = (on: string[] = []): TenantFeature[] =>
  [
    "core",
    "chat-app",
    "community-read",
    "community-write",
    "community-admin",
    "contracts-read",
    "contracts-write",
    "contracts-admin",
    "contracts-approval-engine",
    "han-muc-duyet",
    "ke-toan",
  ].map((k) => feat(k, k === "core" || on.includes(k)));
const card = (app: string, on: string[] = []): AppCard => {
  const c = buildCards(catalog(on)).find((x) => x.app === app);
  if (!c) throw new Error(app);
  return c;
};
const set = (...k: string[]) => new Set(k);

describe("buildCards", () => {
  test("mỗi app một thẻ với đúng kiểu điều khiển", () => {
    const cards = buildCards(catalog());
    expect(cards.map((c) => [c.app, c.mode])).toEqual([
      ["core", "core"],
      ["chat", "switch"],
      ["community", "levels"],
      ["contracts", "levels"],
      ["other", "list"],
    ]);
    expect(card("contracts").addons.map((f) => f.key)).toEqual([
      "contracts-approval-engine",
      "han-muc-duyet",
    ]);
    expect(card("chat").main?.key).toBe("chat-app");
  });
  test("catalog thiếu feature mức Sửa ⇒ chỉ chọn được Tắt/Xem", () => {
    const cats = buildCards(catalog().filter((f) => f.key !== "community-write"));
    const c = cats.find((x) => x.app === "community") as AppCard;
    expect(availableLevels(c)).toEqual({ off: true, read: true, write: false, admin: false });
  });
});

describe("level ↔ keys", () => {
  const c = card("contracts");
  test("keysForLevel cộng dồn", () => {
    expect(keysForLevel(c, "off")).toEqual([]);
    expect(keysForLevel(c, "read")).toEqual(["contracts-read"]);
    expect(keysForLevel(c, "write")).toEqual(["contracts-read", "contracts-write"]);
    expect(keysForLevel(c, "admin")).toEqual([
      "contracts-read",
      "contracts-write",
      "contracts-admin",
    ]);
  });
  test("detectLevel: bộ chuẩn", () => {
    expect(detectLevel(c, set())).toEqual({ level: "off", consistent: true });
    expect(detectLevel(c, set("contracts-read", "contracts-write"))).toEqual({
      level: "write",
      consistent: true,
    });
    expect(detectLevel(c, set("contracts-read", "han-muc-duyet"))).toEqual({
      level: "read",
      consistent: true,
    });
  });
  test("detectLevel: bộ không chuẩn ⇒ mức cao nhất + cờ không chuẩn", () => {
    expect(detectLevel(c, set("contracts-write"))).toEqual({ level: "write", consistent: false });
    expect(detectLevel(c, set("contracts-admin", "contracts-read"))).toEqual({
      level: "admin",
      consistent: false,
    });
    expect(detectLevel(c, set("han-muc-duyet"))).toEqual({ level: "off", consistent: false });
  });
  test("setLevel chuẩn hoá và không đụng app khác", () => {
    const draft = set("contracts-write", "community-read", "han-muc-duyet");
    expect([...setLevel(draft, c, "admin")].sort()).toEqual([
      "community-read",
      "contracts-admin",
      "contracts-read",
      "contracts-write",
      "han-muc-duyet",
    ]);
    expect([...setLevel(draft, c, "read")].sort()).toEqual([
      "community-read",
      "contracts-read",
      "han-muc-duyet",
    ]);
  });
  test("Tắt gỡ cả tính năng thêm của app đó", () => {
    const draft = set("contracts-read", "han-muc-duyet", "chat-app");
    expect([...setLevel(draft, c, "off")]).toEqual(["chat-app"]);
  });
  test("setKey không đổi bản gốc", () => {
    const a = set("x");
    expect([...setKey(a, "y", true)].sort()).toEqual(["x", "y"]);
    expect([...a]).toEqual(["x"]);
    expect([...setKey(a, "x", false)]).toEqual([]);
  });
});

describe("diffEntitlements", () => {
  const feats = catalog(["community-read", "contracts-read", "contracts-write", "chat-app"]);
  test("entitledKeys bỏ core", () => {
    expect(entitledKeys(feats).has("core")).toBe(false);
    expect(entitledKeys(feats).size).toBe(4);
  });
  test("không đổi ⇒ không việc", () => {
    expect(diffEntitlements(feats, entitledKeys(feats))).toEqual({ grant: [], revoke: [] });
  });
  test("đổi mức + công tắc ⇒ cấp phần thêm, thu hồi phần bớt, không đụng core", () => {
    const c = card("contracts", ["contracts-read", "contracts-write"]);
    let draft: ReadonlySet<string> = setLevel(entitledKeys(feats), c, "admin");
    draft = setKey(draft, "han-muc-duyet", true);
    draft = setKey(draft, "chat-app", false);
    draft = setKey(draft, "core", false);
    const d = diffEntitlements(feats, draft);
    expect(d.grant.map((f) => f.key).sort()).toEqual(["contracts-admin", "han-muc-duyet"]);
    expect(d.revoke.map((f) => f.key).sort()).toEqual(["chat-app"]);
  });
  test("bộ không chuẩn: lưu không đổi mức vẫn ra diff chuẩn hoá (thêm read)", () => {
    const bad = catalog(["contracts-write"]);
    const c = card("contracts", ["contracts-write"]);
    const d = diffEntitlements(bad, setLevel(entitledKeys(bad), c, "write"));
    expect(d.grant.map((f) => f.key)).toEqual(["contracts-read"]);
    expect(d.revoke).toEqual([]);
  });
});
