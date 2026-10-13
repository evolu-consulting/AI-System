// HUB-FR-66 · HUB-FR-67 · AC-H4b2-01 (vế "role khác → 403") · spec H4b2 §2 Quyền thao tác · test-plan H4b2 §3 Q01–Q03:
// mọi endpoint mới của Models (provider, check, profile) chỉ `platform_admin`; role khác ⇒ 403 trước parse, 0 ghi, không
// gọi hãng; không token ⇒ 401. Ghi chú: `mountH4a` đã chặn `/studio/api/*` ⇒ Q01–Q03 có thể xanh trước code (khoá hồi quy).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type Ctx,
  cfgState,
  DIFY,
  errOf,
  type Res,
  SEC,
  st,
  startH4b2,
  stubFetch,
  type Who,
} from "./_h4b2";

const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
let x: Ctx;
let pid = "";
beforeAll(async () => {
  x = await startH4b2({ fetch: fetchStub });
  const [p] = await x.sql<{ id: string }[]>`select id from hub.providers where key = 'claude-sub'`;
  pid = p?.id ?? DIFY.id;
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

const eps = (): [string, string, unknown][] => [
  ["GET", `/providers/${pid}`, undefined],
  [
    "POST",
    "/providers",
    {
      key: "qc-q-api",
      kind: "api",
      vendor: "openai",
      base_url: null,
      secret_id: SEC.openai,
    },
  ],
  [
    "PUT",
    `/providers/${pid}`,
    { version: 1, base_url: null, secret_id: null, max_concurrency: 9, enabled: true },
  ],
  ["PATCH", `/providers/${pid}/enabled`, { version: 1, enabled: false }],
  ["DELETE", `/providers/${pid}?version=1`, undefined],
  ["POST", `/providers/${pid}/check`, undefined],
  [
    "POST",
    "/model-profiles",
    { key: "qc-q-prof", steps: [{ provider_key: "fake-cli", model: null, on: [] }] },
  ],
  ["GET", "/model-profiles", undefined],
  ["GET", "/providers", undefined],
];

async function each(w: Who | null, expectStatus: number, code?: string): Promise<void> {
  const s0 = await cfgState(x.sql);
  for (const [m, p, b] of eps()) {
    const r: Res = await st(x, w, m, p, b);
    expect([m, p, r.status]).toEqual([m, p, expectStatus]);
    if (code) expect([m, p, errOf(r).code]).toEqual([m, p, code]);
  }
  expect(await cfgState(x.sql)).toEqual(s0);
  expect(fetchStub.calls).toEqual([]);
}

describe("Q01–Q03 · chỉ platform_admin [spec §2 · AC-H4b2-01]", () => {
  it("HUB-FR-66 · AC-H4b2-01 · Q01 · tadmin (tenant_admin acme) ⇒ 403 FORBIDDEN mọi endpoint Models; 0 ghi; không gọi hãng", async () => {
    await each("tadmin", 403, "FORBIDDEN");
  });
  it("HUB-FR-66 · Q02 · lan (member), badmin (tenant_admin beta) ⇒ 403", async () => {
    await each("lan", 403, "FORBIDDEN");
    await each("badmin", 403, "FORBIDDEN");
  });
  it("HUB-FR-66 · Q03 · không token ⇒ 401", async () => {
    await each(null, 401);
  });
});
