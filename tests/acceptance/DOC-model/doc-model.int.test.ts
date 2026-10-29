// CR-101 DOC-model · R3/R4/R30/R36/R42–R46 · Câu 9: HĐ nguyên tắc (chứng từ cha) — đường chính: tạo HĐ NT (tải lên) → gắn con
// (tải lên có `frame_root_id` + gắn HĐ có sẵn) → lệch đối tác ⇒ 422 → chi tiết/danh sách lồng → lên v2 HĐ NT vẫn thấy con → xoá HĐ NT
// giữ con. Cách ly: tenant khác gắn/trỏ HĐ NT ⇒ 404 / FK kép 23503. Viết TRƯỚC code (làn đầy đủ: migration, RLS).
// Hạ tầng HD1 (hub-api THẬT, FileBox giả, không AI: "AI đọc xong" giả bằng SQL). acme: lan = owner gói; beta: an = owner.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CBASE, type Json, pdf } from "../HD1/_support/hd1";
import { arrangeHd7, type CtxN1, d, deal, P, startHd1, T } from "../HD7/_support/hd7";

let c: CtxN1;
type Person = (typeof P)[keyof typeof P];
const PARTNER = "Công ty Đối Tác NT";
const TAX = "0311111111";

beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) await c.sql`delete from contracts.approval_settings where tenant_id = ${T.acme}`;
  await c?.stop();
});

const code = (r: { json: Json }) => r.json?.error?.code ?? null;

async function upload(p: Person, path: string, form: Record<string, string>) {
  const fd = new FormData();
  fd.set("file", new File([pdf() as unknown as BlobPart], "nt.pdf", { type: "application/pdf" }));
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  const res = await fetch(`${c.hub.base}${CBASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(p)}` },
    body: fd,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

/** Giả "AI đọc xong + xác nhận" (tắt duyệt): bên bán = mình, bên mua = đối tác NT, hướng bán, hiệu lực d(-30)…d(300). */
async function readAndConfirm(id: string, start = d(-30)): Promise<void> {
  const fv = (value: string) => ({ value, quote: "", verified: true, edited: true });
  await c.sql`update contracts.contracts set direction = 'sale', status = 'active', fields = ${c.sql.json(
    {
      buyer_name: fv(PARTNER),
      buyer_tax_id: fv(TAX),
      supplier_name: fv("Công ty Chúng Tôi"),
      supplier_tax_id: fv("0100000000"),
      start_date: fv(start),
      end_date: fv(d(300)),
      number: fv(`NT-${id.slice(-4)}`),
    },
  )} where id = ${id}`;
}

async function child(o: { partner?: string; tax?: string | null; start?: string; value?: number }) {
  const id = await deal(c.sql, {
    sale: true,
    partner: o.partner ?? PARTNER,
    tax: o.tax === undefined ? TAX : o.tax,
    start: o.start ?? d(0),
    value: o.value ?? 100_000_000,
  });
  await c.sql`update contracts.contracts set locked_at = now() where id = ${id}`;
  return id;
}

async function approvalOff(): Promise<void> {
  await c.sql`insert into contracts.approval_settings (tenant_id, approval_enabled) values (${T.acme}, false)
    on conflict (tenant_id) do update set approval_enabled = false`;
}

describe("CR-101 DOC-model · đường chính HĐ nguyên tắc", () => {
  it("tạo HĐ NT → gắn con → lệch đối tác 422 → chi tiết/danh sách → v2 vẫn thấy con → gỡ", async () => {
    await arrangeHd7(c);
    await approvalOff();
    const up = await upload(P.lan, "", {
      doc_type: "framework",
      credit_limit: "400000000",
      order_terms: "Đặt hàng qua email, giao trong 3 ngày",
    });
    expect(up.status).toBe(201);
    const f = up.json.id as string;
    await readAndConfirm(f);
    const [fr] = await c.sql<
      { t: string; lim: string; n: number }[]
    >`select doc_type as t, credit_limit::text as lim,
      (select count(*)::int from contracts.obligations o where o.contract_id = ${f}) as n
      from contracts.contracts where id = ${f}`;
    // R44: xác nhận HĐ NT không sinh mốc mặc định (trigger HD7 bị bỏ qua).
    expect(fr).toEqual({ t: "framework", lim: "400000000", n: 0 });
    // Mốc tiền ghi tay cho HĐ NT ⇒ 422.
    const manual = await c.sql`insert into contracts.obligations
        (tenant_id, contract_id, direction, kind, seq, due_date, source)
      values (${T.acme}, ${f}, 'receive', 'payment', 9, ${d(10)}, 'manual')`.then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    expect(manual).toBe("EK422");

    // Con tải lên kèm `frame_root_id`; con có sẵn gắn qua API (nhiều id).
    const upChild = await upload(P.lan, "", { frame_root_id: f });
    expect(upChild.status).toBe(201);
    const c1 = await child({ value: 100_000_000 });
    const c2 = await child({ value: 50_000_000, start: d(400) });
    const att = await c.hubCall(P.lan, "POST", `${CBASE}/${f}/attach`, { ids: [c1, c2] });
    expect({ status: att.status, root: att.json?.frame_root_id }).toEqual({ status: 200, root: f });

    // R43: khác đối tác ⇒ 422; tải lên con trỏ chứng từ không phải HĐ NT ⇒ 422 FRAME_INVALID.
    const other = await child({ partner: "Đối tác khác", tax: "0399999999" });
    const bad = await c.hubCall(P.lan, "POST", `${CBASE}/${f}/attach`, { ids: [other] });
    expect({ status: bad.status, code: code(bad) }).toEqual({
      status: 422,
      code: "FRAME_PARTNER_MISMATCH",
    });
    const badUp = await upload(P.lan, "", { frame_root_id: c1 });
    expect({ status: badUp.status, code: code(badUp) }).toEqual({
      status: 422,
      code: "FRAME_INVALID",
    });

    // Chi tiết HĐ NT: giá trị = Σ con, % hạn mức, con ngoài hiệu lực cảnh báo.
    const det = await c.hubCall(P.lan, "GET", `${CBASE}/${f}`);
    const doc = det.json?.doc;
    expect({
      t: doc?.doc_type,
      sum: doc?.summary,
      kids: (doc?.children ?? []).map((k: Json) => [k.id, k.outside_frame]).sort(),
    }).toEqual({
      t: "framework",
      sum: { stage: "active", value: 150_000_000, credit_pct: 37.5, children: 3 },
      kids: [
        [c1, false],
        [c2, true],
        [upChild.json.id, false],
      ].sort(),
    });
    const dc = await c.hubCall(P.lan, "GET", `${CBASE}/${c1}`);
    expect(dc.json?.doc?.frame?.id).toBe(f);

    // Danh sách lồng: con có cha thấy được không đứng riêng; `children` của HĐ NT trong trang.
    const list = (await c.hubCall(P.lan, "GET", `${CBASE}?nest=1&page_size=100`)).json;
    const ids = list.items.map((x: Json) => x.id);
    expect({
      f: ids.includes(f),
      c1: ids.includes(c1),
      other: ids.includes(other),
      kids: list.children.filter((k: Json) => k.frame_root_id === f).length,
      doc: list.docs.find((x: Json) => x.id === f)?.doc_type,
    }).toEqual({ f: true, c1: false, other: true, kids: 3, doc: "framework" });
    const onlyNt = (await c.hubCall(P.lan, "GET", `${CBASE}?doc_type=framework&page_size=100`))
      .json;
    expect({
      has: onlyNt.items.some((x: Json) => x.id === f),
      types: [...new Set(onlyNt.docs.map((x: Json) => x.doc_type))],
    }).toEqual({ has: true, types: ["framework"] });

    // R4: lên v2 của HĐ NT (kế thừa loại) ⇒ con theo chuỗi `root_id`, v2 tiếp quản.
    await c.sql`update contracts.contracts set locked_at = now() where id = ${f}`;
    const v2 = await upload(P.lan, `/${f}/versions`, {});
    expect(v2.status).toBe(201);
    await readAndConfirm(v2.json.id);
    const [s] = await c.sql<{ t: string; sup: boolean }[]>`select v.doc_type as t,
      (select superseded_at is not null from contracts.contracts where id = ${f}) as sup
      from contracts.contracts v where v.id = ${v2.json.id}`;
    expect(s).toEqual({ t: "framework", sup: true });
    const det2 = await c.hubCall(P.lan, "GET", `${CBASE}/${v2.json.id}`);
    expect(det2.json?.doc?.summary?.children).toBe(3);
    // DOC-ui-gaps: `docs` trả `root_id` (v2 có id khác root_id) + `source` null với HĐ — UI khớp `children.frame_root_id` theo root_id.
    const nested = (await c.hubCall(P.lan, "GET", `${CBASE}?nest=1&page_size=100`)).json;
    const d2 = nested.docs.find((x: Json) => x.id === v2.json.id);
    expect({
      root: d2?.root_id,
      source: d2?.source,
      kids: nested.children.filter((k: Json) => k.frame_root_id === d2?.root_id).length,
    }).toEqual({ root: f, source: null, kids: 3 });

    // Gỡ liên kết ⇒ con đứng riêng.
    const det1 = await c.hubCall(P.lan, "DELETE", `${CBASE}/${c1}/frame`);
    expect({ s: det1.status, d: det1.json?.detached }).toEqual({ s: 200, d: true });
    const [g] = await c.sql<{ fr: string | null }[]>`select frame_root_id::text as fr
      from contracts.contracts where id = ${c1}`;
    expect(g?.fr).toBeNull();
  }, 120_000);

  it("R36 · xoá HĐ NT (một phiên bản): xem trước đếm con; xoá ⇒ con giữ, frame_root_id = null", async () => {
    await arrangeHd7(c);
    const up = await upload(P.lan, "", { doc_type: "framework" });
    const f = up.json.id as string;
    await readAndConfirm(f);
    const k = await child({});
    expect((await c.hubCall(P.lan, "POST", `${CBASE}/${f}/attach`, { ids: [k] })).status).toBe(200);
    const pv = await c.hubCall(P.lan, "GET", `${CBASE}/${f}/delete-preview`);
    expect(pv.json?.frame_children).toBe(1);
    const del = await c.hubCall(P.lan, "DELETE", `${CBASE}/${f}`, {});
    expect(del.status).toBe(200);
    const [r] = await c.sql<{ fr: string | null; n: number }[]>`select frame_root_id::text as fr,
      (select count(*)::int from contracts.contracts where id = ${f}) as n from contracts.contracts where id = ${k}`;
    expect(r).toEqual({ fr: null, n: 0 });
  }, 60_000);
});

describe("CR-101 DOC-model · cách ly tenant cột/FK mới", () => {
  it("owner beta gắn vào HĐ NT acme ⇒ 404; hàng beta trỏ HĐ NT acme ⇒ FK kép 23503 (≡ id không tồn tại)", async () => {
    await arrangeHd7(c);
    const up = await upload(P.lan, "", { doc_type: "framework" });
    const f = up.json.id as string;
    const mine = await deal(c.sql, { tenant: T.beta, sale: true });
    const r = await c.hubCall(P.an, "POST", `${CBASE}/${f}/attach`, { ids: [mine] });
    expect(r.status).toBe(404);
    const upB = await upload(P.an, "", { frame_root_id: f });
    expect({ status: upB.status, code: code(upB) }).toEqual({ status: 422, code: "FRAME_INVALID" });
    const probe = async (target: string) => {
      try {
        await c.sql`update contracts.contracts set frame_root_id = ${target} where id = ${mine}`;
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? "?";
      }
    };
    expect([await probe(f), await probe(crypto.randomUUID())]).toEqual(["23503", "23503"]);
  }, 60_000);
});
