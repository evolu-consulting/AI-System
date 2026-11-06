// CR-122 · E5d · huỷ phong bì QUÁ HẠN phải giành quyền trước khi ra nhà cung cấp và chỉ chạm ĐÚNG phong bì đã quét. DB thật (pool hub_api, role
// gói) + nhà cung cấp GIẢ (mượn khoá `misa`, đếm lời gọi `voidEnvelope`) + đồng hồ giả:
// (1) nhiều lượt cùng huỷ một phong bì (và hai lượt quét song song) ⇒ nhà cung cấp bị gọi MỘT lần, MỘT sự kiện `esign.voided`;
// (2) gửi lại phong bì mới cho HĐ sau khi quét ⇒ phong bì mới không bị huỷ nhầm (kể cả khi tham chiếu phong bì cũ còn sót);
// (3) tiến trình chết sau khi giành quyền ⇒ trong lease không ai huỷ, hết lease lượt sau giành lại được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { ESignFiles } from "../application/esign.ports";
import { sweepEsignOnce } from "../application/esign-sweep";
import { type ESignModule, esignModule, esignSweepDeps } from "../esign.mount";
import { fakeESign } from "./esign.fake";

let o: Sql;
let db: Db;
let u: ESignModule;
let T = "";
let U = "";
let K: string[] = [];
const base = fakeESign();
const voidCalls: string[] = [];
const fake = {
  ...base,
  key: "misa",
  voidEnvelope: async (id: string, reason: string) => {
    voidCalls.push(id);
    await Promise.resolve(); // nhường lượt ⇒ các lời gọi song song thật sự chồng nhau
    return base.voidEnvelope(id, reason);
  },
} as ReturnType<typeof fakeESign>;
const H = 3_600_000;
const MIN = 60_000;
const BASE = new Date(Date.now() + 4 * H);
const at = (ms: number) => new Date(BASE.getTime() + ms);
const files: ESignFiles = () => ({
  getContent: async () => new Uint8Array([37, 80, 68, 70]),
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});
const fired: { contract: string; event: string }[] = [];
const firedOf = (cid: string) => fired.filter((f) => f.contract === cid).map((f) => f.event);

/** Phong bì mở thật ở nhà cung cấp giả + hàng DB (gửi `sentAgoMs` trước BASE, hạn `due` giờ). Trả {id, envelopeId}. */
async function seed(cid: string, sentAgoMs: number, due: number) {
  const { envelopeId } = await fake.createEnvelope({
    subject: "s",
    title: "t",
    number: null,
    document: { name: "hd.pdf", bytes: new Uint8Array([1]) },
    signers: [{ role: "company", name: "A", email: "a@x.vn", order: 1, clientUserId: U }],
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
  ];
  const [r] = await o<{ id: string }[]>`insert into contracts.esign_envelopes
      (tenant_id, contract_id, provider, envelope_id, signers, sent_by, due_h, created_at)
    values (${T}, ${cid}, 'misa', ${envelopeId}, ${o.json(signers as never)}, ${U}, ${due}, ${at(-sentAgoMs)})
    returning id`;
  return { id: r?.id as string, envelopeId };
}
const status = async (id: string) =>
  (await o<{ status: string }[]>`select status from contracts.esign_envelopes where id = ${id}`)[0]
    ?.status;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 995)) as [string];
  [U] = (await users(o, T, 1, { from: 995 })) as [string];
  K = await contracts(o, T, 4, { from: 995, createdBy: U, owner: U });
  db = createDb(urls().hubApi, { max: 6 });
  u = esignModule(db, { esign: { providers: [fake] }, files });
  u.bindCompleted(async (_t, contract, event) => void fired.push({ contract, event }));
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const sweepAt = (ms: number) =>
  sweepEsignOnce(
    esignSweepDeps(db, async () => [T], undefined, u.expireOpen),
    at(ms),
  );

describe("E5d · giành quyền huỷ phong bì quá hạn", () => {
  it("nhiều lượt cùng huỷ một phong bì ⇒ nhà cung cấp bị gọi một lần, một sự kiện esign.voided", async () => {
    const cid = K[0] as string;
    const e = await seed(cid, 5 * H, 3); // gửi 5h trước, hạn 3h ⇒ quá hạn
    const now = at(0);
    const r = await Promise.all([1, 2, 3].map(() => u.expireOpen(T, cid, e.id, now)));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(voidCalls.filter((c) => c === e.envelopeId)).toHaveLength(1);
    expect(firedOf(cid)).toEqual(["esign.voided"]);
    expect(await status(e.id)).toBe("voided");
    // hai lượt quét song song trên HĐ khác: vẫn chỉ một lần huỷ, một sự kiện
    const c2 = K[1] as string;
    const e2 = await seed(c2, 5 * H, 3);
    const sums = await Promise.all([sweepAt(0), sweepAt(0)]);
    expect(sums.reduce((n, s) => n + s.envExpired, 0)).toBe(1);
    expect(voidCalls.filter((c) => c === e2.envelopeId)).toHaveLength(1);
    expect(firedOf(c2)).toEqual(["esign.voided"]);
  });

  it("gửi lại phong bì mới sau khi quét ⇒ phong bì mới không bị huỷ nhầm, tham chiếu cũ không chạm được", async () => {
    const cid = K[2] as string;
    const e1 = await seed(cid, 5 * H, 3);
    expect((await sweepAt(0)).envExpired).toBe(1);
    expect(await status(e1.id)).toBe("voided");
    // gửi lại: phong bì mới (hạn 1h) gửi lúc BASE ⇒ chưa quá hạn lúc BASE
    const e2 = await seed(cid, 0, 1);
    expect((await sweepAt(0)).envExpired).toBe(0);
    expect(await status(e2.id)).toBe("sent");
    // hết hạn của phong bì MỚI: huỷ bằng tham chiếu CŨ (e1) vẫn không đụng e2
    expect(await u.expireOpen(T, cid, e1.id, at(2 * H))).toBe(false);
    expect(await status(e2.id)).toBe("sent");
    expect(voidCalls.filter((c) => c === e2.envelopeId)).toHaveLength(0);
    // đến đúng hạn của e2 thì chính nó bị huỷ
    expect((await sweepAt(2 * H)).envExpired).toBe(1);
    expect(await status(e2.id)).toBe("voided");
    expect(firedOf(cid)).toEqual(["esign.voided", "esign.voided"]);
  });

  it("tiến trình chết sau khi giành quyền ⇒ trong lease không ai huỷ, hết lease lượt sau giành lại", async () => {
    const cid = K[3] as string;
    const e = await seed(cid, 5 * H, 3);
    // mô phỏng: một tiến trình giành quyền lúc BASE rồi chết (chưa gọi nhà cung cấp)
    await o`update contracts.esign_envelopes set expire_claimed_at = ${at(0)} where id = ${e.id}`;
    expect((await sweepAt(5 * MIN)).envExpired).toBe(0); // lease 10 phút chưa hết
    expect(await u.expireOpen(T, cid, e.id, at(5 * MIN))).toBe(false);
    expect(await status(e.id)).toBe("sent");
    expect(voidCalls.filter((c) => c === e.envelopeId)).toHaveLength(0);
    expect((await sweepAt(11 * MIN)).envExpired).toBe(1); // hết lease ⇒ giành lại, huỷ
    expect(await status(e.id)).toBe("voided");
    expect(firedOf(cid)).toEqual(["esign.voided"]);
  });
});
