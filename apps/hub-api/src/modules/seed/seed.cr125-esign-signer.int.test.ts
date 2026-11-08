// CR-126 · cr126-seed-esign-signer · D7: công ty fixture sau `writeCr125Config` gửi ký số được ở Phần 2 «Hợp đồng» của «Quy trình mua hàng»:
// lượt con dùng bản công ty (có người ký = nhóm Giám đốc) ⇒ `esignConfigIssues` rỗng (planSend không ném ESIGN_NODE_NO_SIGNER); chạy lại không nhân đôi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { decodeEsignNodeArgs, esignConfigIssues } from "@ai/contracts/pack-contracts";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { PURCHASE_PHASE_KEYS } from "../processes/library/purchase-templates";
import { resolveSubprocessDef } from "../processes/nodes/subprocess/subprocess-def";
import { writeCr125Config } from "./seed.cr125-config";

const T = "00000000-0000-4000-8000-000000012602";
const TK = "t12602";
let o: Sql;
let db: Db;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${T}, ${TK}, 'T')`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
    select f.id, ${T}, null from admin.features f where f.key = 'contracts-read' on conflict do nothing`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-126 · seed người ký Phần 2 «Hợp đồng»", () => {
  it("seed công ty: bước Ký số của Phần 2 có người ký nhóm Giám đốc", async () => {
    const r1 = await o.begin((tx) => writeCr125Config(tx as never, [TK]));
    expect(r1.esignSigners).toBe(1);
    expect(r1.esign).toBe(1);
    const [g] = await o`select id from admin.groups where tenant_id = ${T} and key = 'giam-doc'`;
    const def = await withHubScope(db, { kind: "user", tenantId: T, userId: T }, (tx) =>
      resolveSubprocessDef({ db } as never, tx, T, PURCHASE_PHASE_KEYS[1]),
    );
    const esign = (
      (def?.stages ?? []) as { key: string; executor?: { args?: Record<string, unknown> } }[]
    ).find((s) => s.key === "ky-so");
    const signers = (esign?.executor?.args?.company_signers as { value: string } | undefined)
      ?.value;
    expect(signers).toBe(`group:${g?.id}`);
    const dec = decodeEsignNodeArgs({ company_signers: signers ?? "" });
    expect(dec.ok && esignConfigIssues(dec.config)).toEqual([]);
    const [s] =
      await o`select esign_enabled, esign_default_provider from contracts.approval_settings where tenant_id = ${T}`;
    expect(s).toMatchObject({ esign_enabled: true, esign_default_provider: "selfsign" });
    const r2 = await o.begin((tx) => writeCr125Config(tx as never, [TK]));
    expect(r2.esignSigners).toBe(0);
    const [n] =
      await o`select count(*)::int as n from hub.process_defs where tenant_id = ${T} and key = ${PURCHASE_PHASE_KEYS[1]}`;
    expect(n?.n).toBe(1);
  });
});
