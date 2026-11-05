// CR-118 · cr118-feature-gate-web · adapter HTTP với web-kit thật + fetch giả: If-None-Match, 304 ⇒ not-modified, 403 ném ApiError.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError, setAuthHooks } from "@ai/web-kit/http";
import { fetchPackMe } from "./http";

const realFetch = globalThis.fetch;
let seen: Headers[] = [];
let status = 200;
const body = {
  versions: { admin: 1, hub: 2 },
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: "22222222-2222-4222-8222-222222222222",
    role: "m",
    kind: "internal",
  },
  packs: {},
  addons: [],
  flags: { contracts: true },
  brand: null,
  home: null,
  apps: ["contracts"],
};

beforeEach(() => {
  seen = [];
  status = 200;
  setAuthHooks({ getToken: () => "t", refresh: async () => null });
  globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    if (status === 304) return new Response(null, { status: 304 });
    if (status === 403)
      return new Response(JSON.stringify({ error: { code: "PACK_DISABLED", message: "x" } }), {
        status,
      });
    return new Response(JSON.stringify(body), { status, headers: { ETag: '"a1.h2.x"' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthHooks(null);
});

describe("fetchPackMe", () => {
  test("200 ⇒ fresh + ETag, không gửi If-None-Match lần đầu", async () => {
    const r = await fetchPackMe(null);
    expect(r.status).toBe("fresh");
    if (r.status === "fresh") expect(r.etag).toBe('"a1.h2.x"');
    expect(seen[0]?.get("If-None-Match")).toBeNull();
  });
  test("gửi If-None-Match và 304 là not-modified", async () => {
    status = 304;
    expect((await fetchPackMe('"a1.h2.x"')).status).toBe("not-modified");
    expect(seen[0]?.get("If-None-Match")).toBe('"a1.h2.x"');
  });
  test("403 ⇒ ApiError 403", async () => {
    status = 403;
    await expect(fetchPackMe(null)).rejects.toBeInstanceOf(ApiError);
  });
});
