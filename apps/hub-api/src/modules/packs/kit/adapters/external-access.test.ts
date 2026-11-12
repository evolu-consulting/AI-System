// CR-102a · com-c2-ext-deny · luật thuần user ngoài: đường dẫn hub-api được phép (`externalPathAllowed`), quyền gói qua
// `packAccessInput` (grant Group bị bỏ qua, chỉ `EXTERNAL_SURFACES`), (agent + Chat App: `agents/agent-access.external.test.ts`).
import { describe, expect, test } from "bun:test";
import { EXTERNAL_SURFACES, externalPathAllowed } from "../domain/external-access.rules";
import { checkPackAccess, packActionsFor } from "../domain/pack-access.rules";
import {
  type PackAccessView,
  type PackCatalogView,
  packAccessInput,
  packEnabled,
} from "./pack-guard.middleware";

const T = "t1";
const features = (k: string) =>
  ["read", "write", "admin"].map((a) => ({ id: `${k}-${a}`, key: `${k}-${a}`, status: "on" }));
// ADR-0044: mặt `community` = gói `contracts` ∧ add-on `contracts-community` (không còn feature `community-*`).
const ADDON = { id: "contracts-community", key: "contracts-community", status: "on" };
const cat: PackCatalogView = {
  features: [...features("contracts"), ADDON],
  entitled: new Set([
    ...["read", "write", "admin"].map((a) => `${T}:contracts-${a}`),
    `${T}:${ADDON.id}`,
  ]),
  grantGroups: new Map(
    ["read", "write", "admin"].map((a) => [`${T}:contracts-${a}`, ["g-all"]] as const),
  ),
};
// Group lọt vào DB (giả định xấu nhất) — đối tác vẫn không được tính.
const view: PackAccessView = {
  catalog: async () => cat,
  user: async () => ({ tenantId: T, groupIds: new Set(["g-all"]) }),
};

describe("com-c2 · externalPathAllowed", () => {
  test("chỉ /pack/<EXTERNAL_SURFACES> và chuông", () => {
    expect(Object.keys(EXTERNAL_SURFACES)).toEqual(["community"]);
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
    // nội bộ có quyền gói ⇒ mặt community read + write, KHÔNG admin (ADR-0044)
    expect(
      packActionsFor(await packAccessInput(view, "community", { userId: "u", tenantId: T })),
    ).toEqual(["read", "write"]);
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

  test("ADR-0044 · add-on tắt/thiếu ⇒ mặt community như gói tắt (cả nội bộ lẫn đối tác); contracts không đổi", async () => {
    const noAddon = (c: Partial<PackCatalogView>): PackAccessView => ({
      ...view,
      catalog: async () => ({ ...cat, ...c }),
    });
    const ext = { userId: "x", tenantId: T, userKind: "external" as const };
    const int = { userId: "u", tenantId: T };
    const variants = [
      noAddon({ entitled: new Set([...cat.entitled].filter((e) => !e.includes("community"))) }),
      noAddon({ features: [...features("contracts"), { ...ADDON, status: "off" }] }),
      noAddon({ features: features("contracts") }),
    ];
    for (const v of variants)
      for (const who of [ext, int]) {
        const i = await packAccessInput(v, "community", who);
        expect(packActionsFor(i)).toEqual([]);
        expect(checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.read })).toBe(
          "PACK_DISABLED",
        );
        expect(await packEnabled(v, "community", T)).toBe(false);
      }
    expect(
      packActionsFor(await packAccessInput(variants[0] as PackAccessView, "contracts", int)),
    ).toEqual(["read", "write", "admin"]);
    expect(await packEnabled(view, "community", T)).toBe(true);
  });

  test("ADR-0044 · đối tác: không bao giờ có quyền gói contracts kể cả add-on bật; nội bộ không có Group nào ⇒ FORBIDDEN", async () => {
    const ext = { userId: "x", tenantId: T, userKind: "external" as const };
    for (const a of ["read", "write", "admin"] as const) {
      const i = await packAccessInput(view, "contracts", ext);
      expect(checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction[a] })).toBe(
        "PACK_FORBIDDEN",
      );
    }
    const ia = await packAccessInput(view, "community", ext);
    expect(checkPackAccess({ ...ia, grantedGroupIds: ia.grantedByAction.admin })).toBe(
      "PACK_FORBIDDEN",
    );
    const noGroup: PackAccessView = {
      ...view,
      user: async () => ({ tenantId: T, groupIds: new Set(["g-x"]) }),
    };
    const ii = await packAccessInput(noGroup, "community", { userId: "u", tenantId: T });
    expect(checkPackAccess({ ...ii, grantedGroupIds: ii.grantedByAction.read })).toBe(
      "PACK_FORBIDDEN",
    );
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
