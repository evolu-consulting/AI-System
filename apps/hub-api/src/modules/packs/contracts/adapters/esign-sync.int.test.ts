// esign-sweep2 · int pha đồng bộ phong bì của vòng nền esign-sweep trên DB thật (pool hub_api; câu chọn dưới role `contracts_job`,
// đồng bộ qua đường webhook/làm mới trong tx hệ thống của ĐÚNG tenant), nhà cung cấp GIẢ trong bộ nhớ (`fakeESign`), đồng hồ giả:
// chọn đúng phong bì (mở, nhà cung cấp không demo, tenant bật gói, cũ hơn ngưỡng), đánh dấu lần kiểm, phong bì xong ⇒ bước Ký số
// `completed` (hook esign-flow như webhook) — không lẫn tenant; câu chọn là MỘT câu SQL cố định.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { ESignFiles } from "../application/esign.ports";
import { sweepEsignOnce } from "../application/esign-sweep";
import { esignModule, esignSweepDeps, esignSyncOf, staticESignRegistry } from "../esign.mount";
import { type FakeESign, fakeESign } from "./esign.fake";
import { selfsignProvider } from "./esign.selfsign";

let sql: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let T3 = "";
const k: string[] = [];
const NOW = new Date(Date.now() + 3_600_000); // sau mọi `updated_at = now()` của hàng seed
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
let fake: FakeESign;

const STEP = [
  {
    kind: "esign",
    key: "sign",
    name: "Ký số",
    company_signer: { mode: "owner" },
    partner_signs: false,
    order: "company_first",
    provider: null,
    due_h: 72,
    remind_every_h: 24,
    escalate_group_id: null,
  },
];
const files: ESignFiles = () => ({
  getContent: async () => null,
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});

/** Bước Ký số đã gửi (lượt hiện tại) + phong bì mở `env` của `provider`, cập nhật lần cuối `min` phút trước NOW. */
async function seed(tid: string, cid: string, o: { env: string; provider?: string; min: number }) {
  const owner = (
    await sql<{ o: string }[]>`select owner_user_id::text as o from contracts.contracts
    where id = ${cid}`
  )[0]?.o as string;
  const aid = crypto.randomUUID();
  await sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, flow_steps,
      esign_status, esign_at, esign_signer)
    values (${aid}, ${tid}, ${cid}, 'done', ${owner}, 'engine', ${sql.json(STEP as never)}, 'sent', ${ago(30)}, ${owner})`;
  await sql`update contracts.contracts set run_id = ${aid} where id = ${cid}`;
  await sql`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, signers, sent_by, updated_at)
    values (${tid}, ${cid}, ${o.provider ?? "fake"}, ${o.env},
      ${sql.json([{ role: "company", name: "A", email: "a@x.vn", order: 1, client_user_id: owner }] as never)},
      ${owner}, ${ago(o.min)})`;
  fake.envelopes.set(o.env, {
    id: o.env,
    status: "sent",
    subject: "s",
    signers: [{ name: "A", email: "a@x.vn", order: 1, status: "sent", signedAt: null }],
    reason: null,
    completedAt: null,
    pdf: new Uint8Array(),
  } as never);
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [T1, T2, T3] = (await tenants(sql, 3, 921)) as [string, string, string];
  const [O1] = (await users(sql, T1, 1, { from: 921 })) as [string];
  const [O2] = (await users(sql, T2, 1, { from: 931 })) as [string];
  const [O3] = (await users(sql, T3, 1, { from: 941 })) as [string];
  k.push(...(await contracts(sql, T1, 4, { from: 921, createdBy: O1, owner: O1 })));
  k.push(...(await contracts(sql, T2, 1, { from: 931, createdBy: O2, owner: O2 })));
  k.push(...(await contracts(sql, T3, 1, { from: 941, createdBy: O3, owner: O3 })));
  fake = fakeESign();
  await seed(T1, k[0] as string, { env: "e0", min: 40 }); // cũ nhất ⇒ đồng bộ; nhà cung cấp đã ký xong
  await seed(T1, k[1] as string, { env: "e1", min: 5 }); // mới cập nhật ⇒ chưa tới lượt
  await seed(T1, k[2] as string, { env: "e2", provider: "selfsign", min: 60 }); // ký thử (demo) ⇒ không hỏi
  await seed(T1, k[3] as string, { env: "e4", min: 20 }); // cũ, vẫn chờ ký ⇒ đánh dấu lần kiểm
  await seed(T2, k[4] as string, { env: "e3", min: 30 }); // tenant khác, ký xong
  await seed(T3, k[5] as string, { env: "e5", min: 90 }); // tenant không bật gói ⇒ không chọn
  fake.complete("e0");
  fake.complete("e3");
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const TX_CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\(|select b\.oid,\s+b\.typarray\s+from pg_catalog\.pg_type)/i;
async function counted<T>(fn: () => Promise<T>): Promise<{ r: T; queries: number }> {
  // biome-ignore lint/suspicious/noExplicitAny: hook debug của pool postgres.js (đếm câu)
  const opts = (db as any).db.$client.options as { debug?: unknown };
  const prev = opts.debug;
  let n = 0;
  opts.debug = (_c: number, q: string) => {
    if (!TX_CTL.test(q)) n += 1;
  };
  try {
    return { r: await fn(), queries: n };
  } finally {
    opts.debug = prev;
  }
}
const envs = async () =>
  new Map(
    (
      await sql<
        { e: string; st: string; chk: Date | null }[]
      >`select envelope_id as e, status as st,
        sync_checked_at as chk from contracts.esign_envelopes where tenant_id = any(${sql.array([T1, T2, T3])}::uuid[])`
    ).map((r) => [r.e, r]),
  );
const stepOf = async (cid: string) =>
  (
    await sql<{ st: string }[]>`select a.esign_status as st from contracts.approvals a
      join contracts.contracts c on c.run_id = a.id where c.id = ${cid}`
  )[0]?.st;

describe("esign-sweep2 · pha đồng bộ phong bì với nhà cung cấp", () => {
  it("chọn đúng phong bì + đánh dấu lần kiểm; ký xong ⇒ bước Ký số completed đúng tenant; câu chọn một câu", async () => {
    const providers = [fake, selfsignProvider()];
    const u = esignModule(db, { esign: { providers }, files });
    const sync = esignSyncOf(db, staticESignRegistry(providers), u, {});
    const deps = esignSweepDeps(db, async () => [T1, T2], sync);

    const c = await counted(() => sync.claim({ now: ago(-1), minMin: 15, max: 1, tenants: [T3] }));
    expect(c.r.map((x) => x.envelopeId)).toEqual(["e5"]); // tenant chỉ định ⇒ chỉ hàng của nó
    expect(c.queries).toBe(1);
    await sql`update contracts.esign_envelopes set sync_checked_at = null where envelope_id = 'e5'`;

    const p1 = await sweepEsignOnce(deps, NOW);
    expect(p1).toMatchObject({ synced: 3, syncFailed: 0 });
    const e = await envs();
    expect(e.get("e0")?.st).toBe("completed");
    expect(e.get("e3")?.st).toBe("completed");
    expect(e.get("e4")).toMatchObject({ st: "sent" });
    expect(e.get("e4")?.chk?.getTime()).toBe(NOW.getTime());
    for (const x of ["e1", "e2", "e5"]) expect(e.get(x)?.chk ?? null).toBeNull();
    expect(await stepOf(k[0] as string)).toBe("completed");
    expect(await stepOf(k[4] as string)).toBe("completed"); // tenant T2 qua tx của T2
    expect(await stepOf(k[3] as string)).toBe("sent");
    expect(await stepOf(k[5] as string)).toBe("sent"); // T3 không chạm

    const p2 = await sweepEsignOnce(deps, NOW); // vừa kiểm ⇒ không gọi lại
    expect(p2).toMatchObject({ synced: 0 });

    const p3 = await sweepEsignOnce(deps, new Date(NOW.getTime() + 20 * 60_000));
    expect(p3).toMatchObject({ synced: 2 }); // e4 (kiểm 20' trước) + e1 (cập nhật 25' trước)
  });
});
