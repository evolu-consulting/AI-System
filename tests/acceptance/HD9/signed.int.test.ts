// HD-FR-95 · BR-9 · D9-16 · HD9-AC05: tải văn bản đã ký (XML hoá đơn/tờ khai, PDF), gắn với chữ ký theo serial, tải lại ⇒ bỏ qua,
// serial lạ ⇒ unmatched, đuôi sai ⇒ unreadable, văn bản của chữ ký cũ hiện ở chữ ký mới sau gia hạn; > 50 tệp ⇒ 413.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeCks,
  type CtxN1,
  customerNamed,
  KBASE,
  kcall,
  ok,
  P,
  startHd1,
  world,
} from "./_support/hd9";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const len = (n: number): number[] =>
  n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
const tlv = (tag: number, body: number[]): number[] => [tag, ...len(body.length), ...body];
const seq = (...xs: number[][]) => tlv(0x30, xs.flat());
const int = (hex: string) => tlv(0x02, hex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
const oid = tlv(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
const cert = (serialHex: string) =>
  btoa(
    String.fromCharCode(
      ...seq(seq(tlv(0xa0, int("02")), int(serialHex), seq(oid), seq()), seq(oid), tlv(0x03, [0])),
    ),
  );
const invoice = (no: string, serialHex: string) =>
  new File(
    [
      `<HDon><DLHDon><TTChung><SHDon>${no}</SHDon><NLap>2026-09-0${no.length}</NLap></TTChung></DLHDon>` +
        `<DSCKS><NBan><Signature><KeyInfo><X509Data><X509Certificate>${cert(serialHex)}</X509Certificate>` +
        "</X509Data></KeyInfo></Signature></NBan></DSCKS></HDon>",
    ],
    `hd-${no}.xml`,
  );

async function upload(files: File[]) {
  const f = new FormData();
  for (const x of files) f.append("files", x);
  const r = await fetch(`${c.hub.base}${KBASE}/signed-docs/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(P.hoa)}` },
    body: f,
  });
  return { status: r.status, json: await r.json() };
}

describe("HD9-AC05 · văn bản đã ký", () => {
  it("gắn theo serial (khác cách viết), tải lại ⇒ skipped, serial lạ ⇒ unmatched, đuôi sai ⇒ unreadable; lọc theo loại", async () => {
    await arrangeCks(c);
    await world(c);
    const r = await upload([
      invoice("12", "54010B7233AF9E10"),
      invoice("7", "00DEAD"),
      new File(["x"], "ghi-chu.docx"),
    ]);
    expect(r).toEqual({ status: 200, json: { added: 2, skipped: 0, unmatched: 1, unreadable: 1 } });
    expect((await upload([invoice("12", "54010B7233AF9E10")])).json).toEqual({
      added: 0,
      skipped: 1,
      unmatched: 0,
      unreadable: 0,
    });
    const bv = await customerNamed(c, "Bếp Việt");
    const holder = bv.certs.find((x: { serial: string }) => x.serial === "5401 0B72 33AF 9E10");
    expect(holder.signed_count).toBe(1);
    expect(bv.signed_count).toBe(1);
    const docs = await kcall(
      c,
      P.tam,
      "GET",
      `/signed-docs?customer_id=${bv.company_id}&certificate_id=${holder.id}`,
    );
    expect(docs.json).toEqual([
      {
        id: expect.any(String),
        certificate_id: holder.id,
        kind: "invoice",
        number: "12",
        title: "Hóa đơn số 0000012",
        signed_at: "2026-09-02",
        source: "xml",
        contract_id: null,
      },
    ]);
    const none = await kcall(
      c,
      P.tam,
      "GET",
      `/signed-docs?customer_id=${bv.company_id}&kind=tax_return`,
    );
    expect(none.json).toEqual([]);
  });
  it("sau gia hạn, văn bản chữ ký cũ được đếm và liệt kê ở chữ ký mới", async () => {
    await arrangeCks(c);
    const w = await world(c);
    await upload([invoice("12", "54010B7233AF9E10")]);
    const ren = await ok(kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, {}));
    await ok(
      kcall(c, P.hoa, "POST", `/renewals/${ren.id}/complete`, { serials: {}, valid_to: null }),
    );
    const bv = await customerNamed(c, "Bếp Việt");
    expect(bv.signed_count).toBe(1);
    const fresh = bv.certs.find((x: { signed_count: number }) => x.signed_count === 1);
    const docs = await kcall(
      c,
      P.tam,
      "GET",
      `/signed-docs?customer_id=${bv.company_id}&certificate_id=${fresh.id}`,
    );
    expect(docs.json.map((d: { number: string }) => d.number)).toEqual(["12"]);
  });
  it("> 50 tệp ⇒ 413, không ghi gì", async () => {
    await arrangeCks(c);
    const many = Array.from({ length: 51 }, (_, i) => invoice(String(i + 100), "AB"));
    expect((await upload(many)).status).toBe(413);
    const [n] = await c.sql`select count(*)::int as n from contracts.cks_signed_docs`;
    expect(n?.n).toBe(0);
  });
});
