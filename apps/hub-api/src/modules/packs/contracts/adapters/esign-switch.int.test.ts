// CR-125 · m4 · MOD-FR-11 · đổi cách ký lúc ký — DB thật (pool hub_api, role gói, RLS tenant) + nhà cung cấp giả:
// (1) hai lượt đổi CÙNG LÚC trên một phong bì ⇒ đúng MỘT lần huỷ ở nhà cung cấp, MỘT phong bì mới, lượt kia nhận ESIGN_STATE rõ ràng;
//     phong bì cũ `voided` (switch-provider) + MỘT dòng audit (người đổi, cách cũ + mã phong bì cũ, cách mới);
// (2) huỷ ở nhà cung cấp hụt ⇒ ESIGN_RESEND_FAILED, phong bì cũ vẫn mở (là phong bì sống), nhả quyền ⇒ bấm lại đổi được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/public";
import { ESignFail } from "../application/esign.helpers";
import type { ESignProvider, StoredSigner } from "../application/esign.ports";
import { esignSwitch } from "../application/esign-switch";
import { esignRepo } from "./esign.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let K: string[] = [];
let failVoid = false;
const voidCalls: string[] = [];
let seq = 0;

const signers = (): StoredSigner[] => [
  {
    role: "company",
    name: "A",
    email: "a@x.vn",
    order: 1,
    client_user_id: U,
    status: null,
    signed_at: null,
  },
];
const provider = (key: string) =>
  ({
    key,
    voidEnvelope: async (id: string) => {
      voidCalls.push(id);
      await Promise.resolve(); // nhường lượt ⇒ hai lượt thật sự chồng nhau
      if (failVoid) throw new Error("void-down");
    },
  }) as unknown as ESignProvider;

function build() {
  const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({ esign: esignRepo(tx, t) }));
  return esignSwitch({
    uow,
    avail: (k) => (k === "docusign" || k === "selfsign" ? provider(k) : null),
    warn: undefined,
    // gửi lại = chèn phong bì mới qua repo thật (index một phần: tối đa một phong bì mở mỗi HĐ)
    send: async (who, id, _s, key) => {
      const ok = await uow.tenant(who, (r) =>
        r.esign.insert({
          contractId: id,
          provider: key,
          envelopeId: `new-${++seq}`,
          signers: signers(),
          sentBy: who.userId,
        }),
      );
      if (!ok) throw new ESignFail("ESIGN_STATE", "already-open");
    },
    reopen: async (who, id) => {
      const e = await uow.tenant(who, (r) => r.esign.latest(id));
      if (!e) throw new Error("no-envelope");
      return e;
    },
    kindOf: (k) => (k === "selfsign" ? "ca" : "envelope"),
  });
}

async function seed(cid: string) {
  const [r] = await o<{ id: string }[]>`insert into contracts.esign_envelopes
      (tenant_id, contract_id, provider, envelope_id, signers, sent_by, due_h)
    values (${T}, ${cid}, 'docusign', ${`old-${cid}`}, ${o.json(signers() as never)}, ${U}, 72)
    returning id`;
  const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({ esign: esignRepo(tx, t) }));
  const e = await uow.tenant({ tenantId: T, userId: U }, (x) => x.esign.latest(cid));
  if (!e || e.id !== r?.id) throw new Error("seed");
  return e;
}
const rows = (cid: string) =>
  o<
    { envelope_id: string; status: string; reason: string | null }[]
  >`select envelope_id, status, reason
    from contracts.esign_envelopes where contract_id = ${cid} order by created_at, id`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 996)) as [string];
  [U] = (await users(o, T, 1, { from: 996 })) as [string];
  K = await contracts(o, T, 2, { from: 996, createdBy: U, owner: U });
  db = createDb(urls().hubApi, { max: 6 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 m4 · đổi cách ký (DB thật)", () => {
  it("hai lượt đổi cùng lúc ⇒ một lần huỷ, đúng một phong bì mới, lượt kia ESIGN_STATE; audit một dòng", async () => {
    const cid = K[0] as string;
    const e = await seed(cid);
    const sw = build();
    const who = { tenantId: T, userId: U };
    const out = await Promise.allSettled([
      sw(who, cid, e, "selfsign"),
      sw(who, cid, e, "selfsign"),
    ]);
    const ok = out.filter((x) => x.status === "fulfilled");
    const bad = out.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    const why: unknown = bad[0]?.reason;
    expect(why instanceof ESignFail ? why.code : String(why)).toBe("ESIGN_STATE");
    expect(voidCalls.filter((v) => v === e.envelopeId)).toHaveLength(1);
    const all = await rows(cid);
    expect(all.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(all.find((r) => r.envelope_id === e.envelopeId)).toMatchObject({
      status: "voided",
      reason: "switch-provider",
    });
    const audit = await o<{ actor_user_id: string; before: unknown; after: unknown }[]>`
      select actor_user_id, before, after from contracts.approval_settings_audit
      where tenant_id = ${T} and before ? 'esign_switch'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      actor_user_id: U,
      before: {
        esign_switch: { contract_id: cid, provider: "docusign", envelope_id: e.envelopeId },
      },
      after: { esign_switch: { contract_id: cid, provider: "selfsign" } },
    });
  });

  it("huỷ ở nhà cung cấp hụt ⇒ ESIGN_RESEND_FAILED, phong bì cũ vẫn mở; bấm lại đổi được", async () => {
    const cid = K[1] as string;
    const e = await seed(cid);
    const sw = build();
    const who = { tenantId: T, userId: U };
    failVoid = true;
    const err = await sw(who, cid, e, "selfsign").catch((x: unknown) => x);
    failVoid = false;
    expect((err as ESignFail).code).toBe("ESIGN_RESEND_FAILED");
    expect([...(await rows(cid))]).toEqual([
      { envelope_id: e.envelopeId, status: "sent", reason: null },
    ]);
    await sw(who, cid, e, "selfsign"); // lease đã nhả ⇒ đổi ngay được
    expect((await rows(cid)).map((r) => r.status)).toEqual(["voided", "sent"]);
  });
});
