// CR-125 · m10 · webhook «voided» của phong bì CŨ chen vào giữa lúc đổi cách ký (sau khi huỷ ở nhà cung cấp, trước khi hàng ghi voided) — DB thật
// (pool hub_api, role gói) + nhà cung cấp giả + module ký số thật (đường `syncEnvelope` như webhook, hook `bindCompleted` = tín hiệu cho lượt):
// trong lease ⇒ webhook chỉ audit, KHÔNG tín hiệu; đổi xong ⇒ webhook phong bì cũ vẫn bị bỏ qua; chỉ sự kiện của phong bì MỚI tới lượt, đúng một lần.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/public";
import { ESignFail } from "../application/esign.helpers";
import type { ESignFiles, ESignProvider, StoredSigner } from "../application/esign.ports";
import { esignSwitch } from "../application/esign-switch";
import { type ESignModule, esignModule } from "../esign.mount";
import { fakeESign } from "./esign.fake";
import { esignRepo } from "./esign.repo";

let o: Sql;
let db: Db;
let u: ESignModule;
let T = "";
let U = "";
let C = "";
const fake = fakeESign();
const fired: string[] = [];
const files: ESignFiles = () => ({
  getContent: async () => null,
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});
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
const newEnvelope = () =>
  fake.createEnvelope({
    subject: "s",
    title: "t",
    number: null,
    document: { name: "hd.pdf", bytes: new Uint8Array([1]) },
    signers: [{ role: "company", name: "A", email: "a@x.vn", order: 1, clientUserId: U }],
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 997)) as [string];
  [U] = (await users(o, T, 1, { from: 997 })) as [string];
  [C] = (await contracts(o, T, 1, { from: 997, createdBy: U, owner: U })) as [string];
  db = createDb(urls().hubApi, { max: 6 });
  u = esignModule(db, { esign: { providers: [fake] }, files });
  u.bindCompleted(async (_t, _c, event) => void fired.push(event));
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 m10 · webhook phong bì cũ giữa lúc đổi cách ký", () => {
  it("trong lease chỉ audit, không tín hiệu, sau khi đổi chỉ phong bì mới tới lượt, một lần", async () => {
    const { envelopeId: oldId } = await newEnvelope();
    await o`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, signers, sent_by, due_h)
      values (${T}, ${C}, 'fake', ${oldId}, ${o.json(signers() as never)}, ${U}, 72)`;
    const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      esign: esignRepo(tx, t),
    }));
    const who = { tenantId: T, userId: U };
    let newId = "";
    let injected = null as boolean | null;
    // huỷ ở nhà cung cấp xong ⇒ nhà cung cấp bắn webhook «voided» NGAY (trước khi hàng ghi voided)
    const racing = {
      ...fake,
      voidEnvelope: async (id: string, reason: string) => {
        await fake.voidEnvelope(id, reason);
        injected = await u.syncEnvelope(T, "fake", id);
      },
    } as unknown as ESignProvider;
    const sw = esignSwitch({
      uow,
      avail: (k) => (k === "fake" ? racing : k === "selfsign" ? fake : null),
      send: async (w, id, _s, key) => {
        newId = (await newEnvelope()).envelopeId;
        const ok = await uow.tenant(w, (r) =>
          r.esign.insert({
            contractId: id,
            provider: "fake",
            envelopeId: newId,
            signers: signers(),
            sentBy: w.userId,
          }),
        );
        if (!ok) throw new ESignFail("ESIGN_STATE", `already-open:${key}`);
      },
      reopen: async (w, id) => {
        const e = await uow.tenant(w, (r) => r.esign.latest(id));
        if (!e) throw new Error("no-envelope");
        return e;
      },
      kindOf: (k) => (k === "selfsign" ? "ca" : "envelope"),
    });
    const old = await uow.tenant(who, (r) => r.esign.latest(C));
    if (!old) throw new Error("seed");

    const out = await sw(who, C, old, "selfsign");
    expect(injected).toBe(true); // webhook đã chạy (map đúng tenant) giữa lúc đổi
    expect(fired).toEqual([]); // không esign.voided lạc ⇒ lượt vẫn chờ
    expect(out.e.envelopeId).toBe(newId);
    const rows = await o<{ envelope_id: string; status: string; reason: string | null }[]>`
      select envelope_id, status, reason from contracts.esign_envelopes where contract_id = ${C} order by created_at, id`;
    expect(rows.map((r) => [r.envelope_id, r.status, r.reason])).toEqual([
      [oldId, "voided", "switch-provider"],
      [newId, "sent", null],
    ]);
    const ignored = await o<
      { after: unknown }[]
    >`select after from contracts.approval_settings_audit
      where tenant_id = ${T} and before ? 'esign_event_ignored'`;
    expect(ignored.map((a) => a.after)).toEqual([{ esign_event_ignored: { status: "voided" } }]);

    // sau khi đổi: webhook phong bì cũ lặp lại vẫn không tín hiệu
    expect(await u.syncEnvelope(T, "fake", oldId)).toBe(true);
    expect(fired).toEqual([]);
    // chỉ sự kiện của phong bì MỚI tới lượt, đúng một lần (webhook lặp không nhân đôi)
    fake.decline(newId, "khong ky");
    await Promise.all([u.syncEnvelope(T, "fake", newId), u.syncEnvelope(T, "fake", newId)]);
    expect(fired).toEqual(["esign.declined"]);
  });
});
