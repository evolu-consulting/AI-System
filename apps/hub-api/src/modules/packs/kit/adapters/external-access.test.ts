// CR-102a · com-c2-ext-deny · luật thuần user ngoài: đường dẫn hub-api được phép (`externalPathAllowed`), quyền gói qua
// `packAccessInput` (grant Group bị bỏ qua, chỉ `EXTERNAL_PACKS`), (agent + Chat App: `agents/agent-access.external.test.ts`).
import { describe, expect, test } from "bun:test";
import { EXTERNAL_PACKS, externalPathAllowed } from "../domain/external-access.rules";
import { checkPackAccess, packActionsFor } from "../domain/pack-access.rules";
import {
  type PackAccessView,
  type PackCatalogView,
  packAccessInput,
} from "./pack-guard.middleware";

const T = "t1";
const features = (k: string) =>
  ["read", "write", "admin"].map((a) => ({ id: `${k}-${a}`, key: `${k}-${a}`, status: "on" }));
const cat: PackCatalogView = {
  features: [...features("contracts"), ...features("community")],
  entitled: new Set(
    ["contracts", "community"].flatMap((k) =>
      ["read", "write", "admin"].map((a) => `${T}:${k}-${a}`),
    ),
  ),
  grantGroups: new Map(
    ["contracts", "community"].flatMap((k) =>
      ["read", "write", "admin"].map((a) => [`${T}:${k}-${a}`, ["g-all"]] as const),
    ),
  ),
};
// Group lọt vào DB (giả định xấu nhất) — đối tác vẫn không được tính.
const view: PackAccessView = {
  catalog: async () => cat,
  user: async () => ({ tenantId: T, groupIds: new Set(["g-all"]) }),
};

describe("com-c2 · externalPathAllowed", () => {
  test("chỉ /pack/<EXTERNAL_PACKS> và chuông", () => {
    expect(Object.keys(EXTERNAL_PACKS)).toEqual(["community"]);
    for (const p of [
      "/pack/community",
      "/pack/community/me",
      "/pack/community/posts/1",
      "/notifications",
    ])
      expect({ p, ok: externalPathAllowed(p) }).toEqual({ p, ok: true });
    for (const p of [
      "/pack/contracts/me",
      "/pack/communityx/me",
      "/pack/",
      "/pack/constructor/me",
      "/conversations",
      "/agents",
      "/directory",
      "/me/stream",
      "/notificationsx",
    ])
      expect({ p, ok: externalPathAllowed(p) }).toEqual({ p, ok: false });
  });
});

describe("com-c2 · packAccessInput bỏ grant Group của đối tác", () => {
  test("nội bộ cùng Group ⇒ read/write/admin; đối tác: contracts ⇒ không gì, community ⇒ read+write", async () => {
    const internal = await packAccessInput(view, "contracts", { userId: "u", tenantId: T });
    expect(packActionsFor(internal)).toEqual(["read", "write", "admin"]);
    const ext = { userId: "x", tenantId: T, userKind: "external" as const };
    const c = await packAccessInput(view, "contracts", ext);
    expect(packActionsFor(c)).toEqual([]);
    expect(checkPackAccess({ ...c, grantedGroupIds: c.grantedByAction.read })).toBe(
      "PACK_FORBIDDEN",
    );
    expect(packActionsFor(await packAccessInput(view, "community", ext))).toEqual([
      "read",
      "write",
    ]);
  });

  test("cờ đối tác từ cache cấu hình cũng đủ (claim vắng); community chưa bật cho tenant ⇒ không gì", async () => {
    const v: PackAccessView = {
      ...view,
      user: async () => ({ tenantId: T, groupIds: new Set(["g-all"]), external: true }),
    };
    expect(
      packActionsFor(await packAccessInput(v, "contracts", { userId: "x", tenantId: T })),
    ).toEqual([]);
    const off: PackAccessView = {
      ...v,
      catalog: async () => ({ ...cat, entitled: new Set<string>() }),
    };
    expect(
      packActionsFor(await packAccessInput(off, "community", { userId: "x", tenantId: T })),
    ).toEqual([]);
  });
});
