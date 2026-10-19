// PK-FR-09 · PK-AC10 · N1 plan §10: route `pkdemo` với use case giả — body sai ⇒ 400, khoá phạm vi trong body bị bỏ, tenant/user
// từ token, `:id` sai dạng / không thấy ⇒ 404, quyền qua guard (viewer ghi ⇒ 403).
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { buildItem, type Item, type NewItem } from "../domain/item";
import { pkdemoRoutes } from "./pkdemo.routes";

const TID = "a5e10000-0000-4000-8000-000000000001";
const UID = "a5e10000-0000-4000-8000-000000000002";
const FEATS = ["read", "write", "admin"].map((a, i) => ({
  id: `f${i}`,
  key: `pkdemo-${a}`,
  status: "on",
}));

function view(actions: string[]): PackAccessView {
  const granted = FEATS.filter((f) => actions.some((a) => f.key.endsWith(a)));
  return {
    catalog: async () => ({
      features: FEATS,
      entitled: new Set(FEATS.map((f) => `${TID}:${f.id}`)),
      grantGroups: new Map(granted.map((f) => [`${TID}:${f.id}`, ["g1"]])),
    }),
    user: async () => ({ tenantId: TID, groupIds: new Set(["g1"]) }),
  };
}

function app(actions: string[]) {
  const seen: { who?: unknown; input?: NewItem } = {};
  let n = 0;
  const store = new Map<string, Item>();
  const r = new Hono<PackGuardVars>();
  r.use(async (c, next) => {
    c.set("user", { userId: UID, tenantId: TID, role: "member" } satisfies AuthUser);
    await next();
  });
  r.route(
    "/",
    pkdemoRoutes(view(actions), {
      create: async (who, input) => {
        Object.assign(seen, { who, input });
        const it = buildItem(
          input,
          () => `a5e10000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
        );
        store.set(it.id, it);
        return it;
      },
      get: async (_who, id) => store.get(id) ?? null,
    }),
  );
  r.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  const call = (method: string, path: string, body?: unknown) =>
    r.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { call, seen };
}

describe("PK-FR-09 · route pkdemo", () => {
  test("POST hợp lệ ⇒ 201, bỏ tenant_id/user_id của body, who từ token; GET lại ⇒ 200 cùng hình", async () => {
    const a = app(["read", "write"]);
    const body = {
      title: "t",
      lines: [{ text: "a" }, { text: "b" }],
      tenant_id: "x",
      user_id: "y",
    };
    const r = await a.call("POST", "/items", body);
    expect(r.status).toBe(201);
    const j = (await r.json()) as Item;
    expect(a.seen.input).toEqual({ title: "t", lines: [{ text: "a" }, { text: "b" }] });
    expect(a.seen.who).toEqual({ tenantId: TID, userId: UID });
    expect(j.lines.map((l) => l.text)).toEqual(["a", "b"]);
    const g = await a.call("GET", `/items/${j.id}`);
    expect([g.status, await g.json()]).toEqual([200, j]);
  });
  test("body sai (title rỗng / > 200, lines > 100, text rỗng, JSON hỏng) ⇒ 400 VALIDATION_ERROR", async () => {
    const a = app(["read", "write"]);
    const bad = [
      { title: "", lines: [] },
      { title: "x".repeat(201), lines: [] },
      { title: "t", lines: Array.from({ length: 101 }, () => ({ text: "a" })) },
      { title: "t", lines: [{ text: "" }] },
      { title: "t" },
    ];
    for (const b of bad) {
      const r = await a.call("POST", "/items", b);
      expect([r.status, ((await r.json()) as { error: { code: string } }).error.code]).toEqual([
        400,
        "VALIDATION_ERROR",
      ]);
    }
    expect(a.seen.input).toBeUndefined();
  });
  test("GET id sai dạng / không có ⇒ 404 NOT_FOUND; viewer POST ⇒ 403 PACK_FORBIDDEN", async () => {
    const a = app(["read"]);
    const s = [
      (await a.call("GET", "/items/khong-uuid")).status,
      (await a.call("GET", `/items/${TID}`)).status,
      (await a.call("POST", "/items", { title: "t", lines: [] })).status,
    ];
    expect(s).toEqual([404, 404, 403]);
  });
});
