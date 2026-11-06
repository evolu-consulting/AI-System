// CR-122 · E5c · vòng quét THEO PHONG BÌ của node Ký số (không có lượt duyệt kiểu cũ), DB thật (pool hub_api, role gói) + nhà cung cấp GIẢ
// (mượn khoá `misa`) + đồng hồ giả: (1) nhắc đúng MỘT lần mỗi chu kỳ `remind_every_h`; (2) quét hai lần liền nhau không gửi trùng (mốc
// `reminded_at`); (3) quá `due_h` ⇒ huỷ phong bì + bắn `esign.voided` cho lượt đang chờ (hook như webhook), chuông MỘT lần, quét lại không lặp.
// Rẽ nhánh `esign.voided` của lượt đã có int riêng (`wait-event-esign.int.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { ESignFiles } from "../application/esign.ports";
import { sweepEsignOnce } from "../application/esign-sweep";
import { esignModule, esignSweepDeps } from "../esign.mount";
import { fakeESign } from "./esign.fake";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let K: string[] = [];
const fake = { ...fakeESign(), key: "misa" } as ReturnType<typeof fakeESign>;
const H = 3_600_000;
const BASE = new Date(Date.now() + 4 * H); // sau mọi `now()` của hàng seed
const at = (h: number) => new Date(BASE.getTime() + h * H);
const files: ESignFiles = () => ({
  getContent: async () => new Uint8Array([37, 80, 68, 70]),
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});
const fired: { tenant: string; contract: string; event: string }[] = [];

/** Phong bì mở thật ở nhà cung cấp giả + hàng DB: gửi lúc `sentAgoH` giờ trước BASE, hạn/nhắc theo node. */
async function seed(cid: string, sentAgoH: number, due: number | null, rem: number | null) {
  const { envelopeId } = await fake.createEnvelope({
    subject: "s",
    title: "t",
    number: null,
    document: { name: "hd.pdf", bytes: new Uint8Array([1]) },
    signers: [
      { role: "company", name: "A", email: "a@x.vn", order: 1, clientUserId: U },
      { role: "partner", name: "B", email: "b@x.vn", order: 2, clientUserId: null },
    ],
  });
  const signers = [
    {
      role: "company",
      name: "A",
      email: "a@x.vn",
      order: 1,
      client_user_id: U,
      status: null,
      signed_at: null,
    },
    {
      role: "partner",
      name: "B",
      email: "b@x.vn",
      order: 2,
      client_user_id: null,
      status: null,
      signed_at: null,
    },
  ];
  await o`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, signers, sent_by, due_h, remind_every_h, created_at)
    values (${T}, ${cid}, 'misa', ${envelopeId}, ${o.json(signers as never)}, ${U}, ${due}, ${rem}, ${at(-sentAgoH)})`;
  return envelopeId;
}
const row = async (cid: string) =>
  (
    await o<
      { status: string; reason: string | null; reminded_at: Date | null; expired_at: Date | null }[]
    >`select status, reason, reminded_at, expired_at from contracts.esign_envelopes where contract_id = ${cid}`
  )[0];

let run: (h: number) => ReturnType<typeof sweepEsignOnce>;
beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 991)) as [string];
  [U] = (await users(o, T, 1, { from: 991 })) as [string];
  K = await contracts(o, T, 3, { from: 991, createdBy: U, owner: U });
  db = createDb(urls().hubApi, { max: 4 });
  const u = esignModule(db, { esign: { providers: [fake] }, files });
  u.bindCompleted(async (tenant, contract, event) => void fired.push({ tenant, contract, event }));
  const deps = esignSweepDeps(db, async () => [T], undefined, u.expireOpen);
  run = (h) => sweepEsignOnce(deps, at(h));
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("E5c · quét theo phong bì của node Ký số", () => {
  it("nhắc đúng MỘT lần mỗi chu kỳ (nhắc mỗi 2h, hạn 48h)", async () => {
    const cid = K[0] as string;
    await seed(cid, 5, 48, 2); // gửi 5h trước ⇒ đã tới hạn nhắc đầu
    expect((await run(0)).envReminded).toBe(1);
    expect((await row(cid))?.reminded_at?.getTime()).toBe(at(0).getTime());
    expect((await run(1)).envReminded).toBe(0); // mới 1h kể từ lần nhắc
    expect((await run(2)).envReminded).toBe(1); // đủ chu kỳ ⇒ nhắc tiếp
    expect((await row(cid))?.reminded_at?.getTime()).toBe(at(2).getTime());
    expect((await row(cid))?.status).toBe("sent");
  });

  it("quét hai lần liền nhau cùng thời điểm ⇒ không nhắc / chuông trùng", async () => {
    const cid = K[1] as string;
    await seed(cid, 30, 99, 24); // gửi 30h trước, chu kỳ 24h ⇒ tới hạn nhắc
    const a = await run(10); // (K[0] cũng nằm trong lô nhưng đã tới mốc riêng — chỉ đếm hiệu số bên dưới)
    const b = await run(10);
    expect(a.envReminded).toBeGreaterThanOrEqual(1);
    expect(b.envReminded).toBe(0);
    expect(b.bells).toBe(0);
    expect((await row(cid))?.reminded_at?.getTime()).toBe(at(10).getTime());
  });

  it("quá hạn ⇒ huỷ phong bì + bắn esign.voided cho lượt, chuông một lần, quét lại không lặp", async () => {
    const cid = K[2] as string;
    await seed(cid, 5, 3, null); // hạn 3h, gửi 5h trước ⇒ quá hạn; không nhắc theo chu kỳ
    const r = await run(20);
    expect(r.envExpired).toBe(1);
    expect(await row(cid)).toMatchObject({ status: "voided", reason: "esign-expired" });
    expect(fired.filter((f) => f.contract === cid)).toEqual([
      { tenant: T, contract: cid, event: "esign.voided" },
    ]);
    const again = await run(21);
    expect(again.envExpired).toBe(0);
    expect(fired.filter((f) => f.contract === cid)).toHaveLength(1);
  });
});
