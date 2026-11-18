// CR-182 · đợt 2 — «Đối tác ký qua link riêng» (DB thật, role gói `contracts_rw` + RLS, hàm DEFINER theo BĂM token; route công khai THẬT `partnerSignRoutes`
// với hạn mức trong bộ nhớ; in PDF thật; FileBox + email giả). Người ký đối tác KHÔNG có tài khoản; người gửi lại (U2) khác người tải lên (U1) — N2.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createCanvas } from "@napi-rs/canvas";
import { Hono } from "hono";
import { PDFDocument } from "pdf-lib";
import { connectDb, type Db } from "../../../../lib/db";
import { partnerSignRoutes } from "../../../partners/adapters/partner-sign.routes";
import { windowLimit } from "../../../partners/adapters/window-limit";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PartnerSignMail } from "../../kit/public";
import { withSystemScope } from "../../kit/testing/system-scope";
import type { PartnerSignRepos } from "../application/partner-sign.deps";
import { PartnerSignFail, partnerSignUsecases } from "../application/partner-sign.usecase";
import { noDigitalSigner, produceSigned } from "../domain/digital-signer";
import { hashLinkToken } from "../domain/partner-sign.rules";
import { contractFilesRepo } from "./contract-files.repo";
import { partnerSignRepo } from "./partner-sign.repo";
import { signDocRepo } from "./sign-doc.repo";
import { signDocsRepo } from "./sign-docs.repo";
import { signFieldsRepo } from "./sign-fields.repo";
import { signOnBack } from "./sign-flow.engine";
import { sha256Hex, stampPdf } from "./sign-stamp.pdf";
import { signVersionsRepo } from "./sign-versions.repo";

const NIL = "00000000-0000-0000-0000-000000000000";
let o: Sql;
let db: Db;
let T = "";
let U1 = ""; // người tải lên / tạo HĐ
let U2 = ""; // người khác (không phải người tải lên, không phải quản trị)
const boxes = new Map<string, Uint8Array>();
const mails: PartnerSignMail[] = [];
let completed = 0;
let ipN = 10;
let puts = 0;

const part = (page: number) => ({
  page,
  x: 40,
  y: 40,
  w: 120,
  h: 50,
  cx: 40,
  cy: 40,
  cw: 120,
  ch: 50,
});
const canvasPng = (): Uint8Array => {
  const c = createCanvas(120, 50);
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(10, 10, 80, 20);
  return c.toBuffer("image/png");
};
const PNG_B64 = Buffer.from(canvasPng()).toString("base64");

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    contractFiles: contractFilesRepo(tx, t),
    signDoc: signDocRepo(tx, t),
    docs: signDocsRepo(tx, t),
    fields: signFieldsRepo(tx, t),
    versions: signVersionsRepo(tx, t),
    partnerSign: partnerSignRepo(tx, t),
  })) as never as import("../../kit/public").PackUow<PartnerSignRepos> &
    import("../../kit/public").PackSystemUow<PartnerSignRepos>;

let off = false;
let onProduce: (() => Promise<void>) | null = null;
const RUN = "7a1d0000-0000-4000-8000-0000000000bb";
const make = () =>
  partnerSignUsecases({
    uow: uow(),
    lookup: (fn) =>
      withPackScope(db, { packKey: "contracts", tenantId: NIL, userId: null }, (tx) =>
        fn(partnerSignRepo(tx, NIL)),
      ),
    files: {
      read: async (_o, id) => boxes.get(id) ?? null,
      put: async (_o, _n, bytes) => {
        puts++;
        const fileId = `out-${puts}-${Bun.randomUUIDv7()}`;
        boxes.set(fileId, bytes);
        return { fileId, versionId: "v1" };
      },
      remove: async (_o, id) => void boxes.delete(id),
    },
    maxBytes: 50_000_000,
    produce: (i) =>
      (onProduce?.() ?? Promise.resolve()).then(() =>
        produceSigned({
          pdf: i.pdf,
          marks: i.marks,
          ink: i.ink,
          kind: i.kind,
          signer: noDigitalSigner,
          stamp: stampPdf,
          sha256: sha256Hex,
        }),
      ),
    mailer: () =>
      off
        ? null
        : {
            sendBatch: async (m) => {
              mails.push(...m);
              return m.map(() => ({ ok: true as const }));
            },
          },
    baseUrl: () => "https://app.test",
    counts: async () => ({ a_done: true, b_total: 1, b_open: 1, run_id: RUN }),
    complete: async () => void completed++,
    log: { info: () => undefined, warn: () => undefined },
    newId: () => Bun.randomUUIDv7(),
    now: () => new Date(),
    orgOf: (t) => `t_${t}`,
  });
const ucs = () => make();

async function pdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]);
  return d.save();
}
const w = (userId: string) => ({ tenantId: T, userId });
async function fileRow(name: string) {
  const bytes = await pdf(3);
  const boxId = `fb-${Bun.randomUUIDv7()}`;
  boxes.set(boxId, bytes);
  const [f] = await o<{ id: string }[]>`insert into contracts.files ${o({
    tenant_id: T,
    org: `t_${T}`,
    file_id: boxId,
    name,
    mime: "application/pdf",
    size_bytes: bytes.byteLength,
    created_by: U1,
  } as never)} returning id`;
  return (f as { id: string }).id;
}
/** HĐ mua (đối tác = bên «supplier») + liên hệ đối tác có email + tệp chính cần ký (ô Bên A của U1 + ô Bên B) + một tệp kèm KHÔNG gửi. */
async function fixture(opts: { second?: boolean } = {}) {
  const tax = String(Math.floor(1e9 + Math.random() * 9e9)); // party_key theo MST ⇒ mỗi HĐ một MST riêng
  const pn = `Công ty Đối Tác ${Bun.randomUUIDv7()}`; // mỗi HĐ một đối tác riêng ⇒ liên hệ đầu tiên là của HĐ này
  const fileId = await fileRow("hop-dong.pdf");
  const [c] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ CR182 đối tác",
    created_by: U1,
    status: "draft",
    direction: "purchase",
    fields: o.json({
      supplier_name: { value: pn },
      supplier_tax_id: { value: tax },
    }) as never,
    file_id: fileId,
  } as never)} returning id`;
  const id = (c as { id: string }).id;
  await o`insert into contracts.partner_contacts (tenant_id, party_key, name, email, created_by)
    values (${T}, contracts.party_key(${pn}, ${tax}), 'Chị Lan', ${`lan-${id.slice(0, 6)}@doitac.vn`}, ${U1})`;
  const [ct] = await o<
    { id: string; email: string }[]
  >`select id, email from contracts.partner_contacts
    where tenant_id = ${T} and email like ${`lan-${id.slice(0, 6)}%`}`;
  await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by) values (${T}, ${id}, ${fileId}, true, 3, ${U1})`;
  const mk = (side: string, kind: string, ref: string, page: number) => ({
    tenant_id: T,
    contract_id: id,
    file_id: fileId,
    side,
    signer_kind: kind,
    signer_ref: ref,
    parts: o.json([part(page)]) as never,
    created_by: U1,
  });
  const fa = await o<
    { id: string }[]
  >`insert into contracts.sign_fields ${o(mk("A", "user", U1, 0) as never)} returning id`;
  const fb = await o<
    { id: string }[]
  >`insert into contracts.sign_fields ${o(mk("B", "partner", (ct as { email: string }).email, 1) as never)} returning id`;
  const other = await fileRow("tep-kem.pdf");
  await o`insert into contracts.contract_files (tenant_id, contract_id, file_id, added_by) values (${T}, ${id}, ${other}, ${U1})`;
  let file2 = "";
  let b2Field = "";
  if (opts.second) {
    file2 = await fileRow("tep-2.pdf");
    await o`insert into contracts.contract_files (tenant_id, contract_id, file_id, added_by) values (${T}, ${id}, ${file2}, ${U1})`;
    await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by) values (${T}, ${id}, ${file2}, true, 3, ${U1})`;
    const [x] = await o<
      { id: string }[]
    >`insert into contracts.sign_fields ${o({ ...mk("B", "partner", (ct as { email: string }).email, 1), file_id: file2 } as never)} returning id`;
    b2Field = (x as { id: string }).id;
  }
  return {
    id,
    fileId,
    file2,
    b2Field,
    other,
    contactId: (ct as { id: string }).id,
    aField: (fa[0] as { id: string }).id,
    bField: (fb[0] as { id: string }).id,
  };
}
/** Tạo link bằng use case thật (mail giả bắt token trong thân thư). */
async function invite(id: string): Promise<string> {
  mails.length = 0;
  expect(await ucs().ensureLink(T, id, { by: U1, force: false })).toBe("created");
  return /\/ky\/([A-Za-z0-9_-]{43})/.exec(mails[0]?.text ?? "")?.[1] as string;
}

const app = () =>
  new Hono().route(
    "/sign-link",
    partnerSignRoutes({
      port: () => {
        const u = ucs();
        return {
          view: u.view,
          content: u.content,
          quick: u.quick,
          sign: u.sign,
          decline: u.decline,
        };
      },
      limit: windowLimit({}),
      hops: 1,
    }) as never,
  );
const http = app();
type Res = { status: number; json: Record<string, unknown> | null; res: Response };
async function call(
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
  ip = `10.1.${++ipN}.1`,
): Promise<Res> {
  const base = `/sign-link/${token}`;
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (method === "POST") {
    const g = await http.request(base, { headers });
    const csrf = ((await g.json().catch(() => ({}))) as { csrf?: string }).csrf ?? "bad";
    Object.assign(headers, {
      cookie: `psc=${csrf}`,
      "x-sign-csrf": csrf,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    });
  }
  const res = await http.request(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ct = res.headers.get("content-type") ?? "";
  return {
    status: res.status,
    json: ct.includes("json") ? ((await res.json()) as never) : null,
    res,
  };
}
const fieldMark = (id: string) => ({
  field_id: id,
  placement: "field",
  parts: [part(1)],
  caption: true,
});
const freeMark = { placement: "free", parts: [part(2)], caption: false };

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9831)) as [string];
  [U1, U2] = (await users(o, T, 2, { from: 9831 })) as [string, string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-182 · đối tác ký qua link", () => {
  it("mời ký: mail có tên công ty, tên HĐ, số tệp, số chỗ, hạn, link /ky/<token>, DB chỉ giữ băm, gọi lại không gửi trùng", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    expect(token).toHaveLength(43);
    const m = mails[0] as PartnerSignMail;
    expect(m.subject).toContain("HĐ CR182 đối tác");
    expect(m.text).toContain("1 tệp cần ký, 1 chỗ ký");
    expect(m.text).toContain(`https://app.test/ky/${token}`);
    expect(m.text).toMatch(/Hạn ký: \d{2}\/\d{2}\/\d{4}/);
    const [l] = await o<
      { h: string; sent: boolean }[]
    >`select encode(token_hash, 'hex') as h, sent_at is not null as sent
      from contracts.partner_sign_links where contract_id = ${f.id}`;
    expect(l?.h).toBe(await hashLinkToken(token));
    expect(l?.sent).toBe(true);
    expect(
      JSON.stringify(
        await o`select * from contracts.partner_sign_links where contract_id = ${f.id}`,
      ),
    ).not.toContain(token);
    expect(await ucs().ensureLink(T, f.id, { by: U1, force: false })).toBe("exists");
    expect(mails).toHaveLength(1);
  });

  it("HUB_NOTIFY_MODE=off: không có transport ⇒ vẫn tạo link (ghi ra log), không ném", async () => {
    const f = await fixture();
    off = true;
    try {
      expect(await ucs().ensureLink(T, f.id, { by: U1, force: false })).toBe("created");
    } finally {
      off = false;
    }
  });

  it("token sai / sai dạng ⇒ 404, hết hạn ⇒ 410, đã thu hồi ⇒ 410", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    const bad = await call("GET", "", "A".repeat(43));
    expect(bad.status).toBe(404);
    expect(bad.res.headers.get("referrer-policy")).toBe("no-referrer"); // token không lọt qua Referer
    expect((await call("GET", "", "ngan")).status).toBe(404);
    expect((await call("GET", "", token)).status).toBe(200);
    await o`update contracts.partner_sign_links set expires_at = now() - interval '1 minute' where contract_id = ${f.id}`;
    expect((await call("GET", "", token)).status).toBe(410);
    await o`update contracts.partner_sign_links set expires_at = now() + interval '1 day', revoked_at = now() where contract_id = ${f.id}`;
    expect((await call("GET", "", token)).status).toBe(410);
  });

  it("link chỉ đọc đúng HĐ và tệp được gửi (tệp kèm không gửi ⇒ 404), không mở được bản huỷ", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    const v = (await call("GET", "", token)).json as {
      files: { file_id: string; fields: unknown[] }[];
      company_name: string;
    };
    expect(v.files.map((x) => x.file_id)).toEqual([f.fileId]);
    expect(v.files[0]?.fields).toHaveLength(1); // chỉ ô Bên B
    expect((await call("GET", `/files/${f.fileId}`, token)).status).toBe(200);
    expect((await call("GET", `/files/${f.other}`, token)).status).toBe(404);
    expect((await call("GET", `/files/${Bun.randomUUIDv7()}`, token)).status).toBe(404);
  });

  it("ký: chưa có chữ ký nhanh ⇒ 400, ô Bên A ⇒ 403, có ảnh ⇒ 400, PNG hỏng ⇒ 422, rồi ký ô Bên B + tự đặt thêm ⇒ HĐ hoàn tất, ký lại ⇒ 409, GET vẫn xem được", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    const sign = (marks: unknown[], extra: object = {}) =>
      call("POST", "/sign", token, { file_id: f.fileId, marks, ...extra });
    expect((await sign([fieldMark(f.bField)])).status).toBe(400); // chưa có chữ ký nhanh
    expect(
      (await call("POST", "/quick-signature", token, { method: "draw", png: "AAAAAAAA" })).status,
    ).toBe(422);
    expect(
      (await call("POST", "/quick-signature", token, { method: "draw", png: PNG_B64, x: 1 }))
        .status,
    ).toBe(400);
    expect(
      (await call("POST", "/quick-signature", token, { method: "type", png: PNG_B64 })).status,
    ).toBe(200);
    expect((await sign([fieldMark(f.aField)])).status).toBe(403); // ô Bên A
    expect((await sign([fieldMark(f.bField)], { png: PNG_B64 })).status).toBe(400); // KHÔNG nhận ảnh
    const before = completed;
    const ok = await sign([fieldMark(f.bField), freeMark]);
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ completed: true, open_fields_left: 0, seq: 1 });
    expect(completed).toBe(before + 1); // thả bước Ký ⇒ HĐ «Đã ký»
    const [v] = await o<
      { signed_by: string | null; c: string | null; label: string | null }[]
    >`select signed_by, signer_contact_id::text as c, signer_label as label
      from contracts.sign_versions where contract_id = ${f.id}`;
    expect(v).toMatchObject({ signed_by: null, c: f.contactId, label: "Đối tác: Chị Lan" });
    const [fl] = await o<
      { v: string | null; by: string | null }[]
    >`select signed_version_id::text as v, signed_by::text as by from contracts.sign_fields where id = ${f.bField}`;
    expect(fl?.v).not.toBeNull();
    expect(fl?.by).toBeNull();
    const [bell] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.notifications where user_id = ${U1} and kind = 'contract.partner_signed'`;
    expect((bell?.n ?? 0) >= 1).toBe(true);
    expect((await sign([freeMark])).status).toBe(409); // đã ký xong
    const view = await call("GET", "", token);
    expect(view.status).toBe(200);
    expect(view.json).toMatchObject({ state: "signed" });
    const latest = (view.json as { files: { latest_version_id: string }[] }).files[0]
      ?.latest_version_id as string;
    expect((await call("GET", `/versions/${f.fileId}/${latest}`, token)).status).toBe(200);
    expect(mails.some((x) => x.subject.includes("đã ký xong"))).toBe(true); // thư cho đối tác
  });

  it("từ chối: ghi lý do, báo người tải lên kèm lý do, từ chối/ký lại ⇒ 409, thiếu lý do ⇒ 400", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    expect((await call("POST", "/decline", token, { reason: "" })).status).toBe(400);
    expect((await call("POST", "/decline", token, { reason: "Giá chưa đúng" })).status).toBe(200);
    const [l] = await o<
      { r: string; d: boolean }[]
    >`select decline_reason as r, declined_at is not null as d from contracts.partner_sign_links where contract_id = ${f.id}`;
    expect(l).toMatchObject({ r: "Giá chưa đúng", d: true });
    const [bell] = await o<
      { body: string }[]
    >`select body from hub.notifications where user_id = ${U1} and kind = 'contract.partner_declined' order by created_at desc limit 1`;
    expect(bell?.body).toContain("Giá chưa đúng");
    expect((await call("POST", "/decline", token, { reason: "lại" })).status).toBe(409);
    expect((await call("GET", "", token)).json).toMatchObject({
      state: "declined",
      decline_reason: "Giá chưa đúng",
    });
  });

  it("gửi lại: chỉ người tải lên/quản trị, link cũ ⇒ 410, link mới mở được, trạng thái link hiện đã gửi/mở/hạn", async () => {
    const f = await fixture();
    const old = await invite(f.id);
    expect((await call("GET", "", old)).status).toBe(200); // ghi opened_at
    const e = await ucs()
      .resend(w(U2), f.id, false)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PartnerSignFail);
    expect((e as PartnerSignFail).kind).toBe("forbidden");
    mails.length = 0;
    const r = await ucs().resend(w(U1), f.id, false);
    expect(r.sent).toBe(true);
    const fresh = /\/ky\/([A-Za-z0-9_-]{43})/.exec(mails[0]?.text ?? "")?.[1] as string;
    expect(fresh).not.toBe(old);
    expect((await call("GET", "", old)).status).toBe(410);
    expect((await call("GET", "", fresh)).status).toBe(200);
    const admin = await ucs().resend(w(U2), f.id, true); // quản trị công ty
    expect(admin.link.state).toBe("open");
    const st = await ucs().status(w(U1), f.id);
    expect(st?.link).toMatchObject({ state: "open", contact_name: "Chị Lan" });
    expect(st?.link?.sent_at).not.toBeNull();
  });

  it("giới hạn tần suất: vượt số lần mở trên một token ⇒ 429 + Retry-After", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    let last = 200;
    let retry: string | null = null;
    for (let i = 0; i < 32 && last !== 429; i++) {
      const r = await call("GET", "", token);
      last = r.status;
      retry = r.res.headers.get("retry-after");
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
  });

  it("thu hồi link giữa lúc in và lúc ghi ⇒ 410, không còn hàng nào được ghi, tệp ra bị xoá", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    expect(
      (await call("POST", "/quick-signature", token, { method: "type", png: PNG_B64 })).status,
    ).toBe(200);
    const before = boxes.size;
    onProduce = async () => {
      await o`update contracts.partner_sign_links set revoked_at = now() where contract_id = ${f.id}`;
    };
    const r = await call("POST", "/sign", token, {
      file_id: f.fileId,
      marks: [fieldMark(f.bField)],
    });
    onProduce = null;
    expect(r.status).toBe(410);
    const [n] = await o<{ v: number; m: number; o: number }[]>`select
      (select count(*) from contracts.sign_versions where contract_id = ${f.id})::int as v,
      (select count(*) from contracts.sign_marks m join contracts.sign_versions v on v.id = m.version_id where v.contract_id = ${f.id})::int as m,
      (select count(*) from contracts.files where tenant_id = ${T} and name like '%(đã ký)%' and created_by = ${U1} and id not in (select out_file_id from contracts.sign_versions))::int as o`;
    expect(n).toMatchObject({ v: 0, m: 0, o: 0 });
    expect(boxes.size).toBe(before);
    const [fl] = await o<
      { v: string | null }[]
    >`select signed_version_id::text as v from contracts.sign_fields where id = ${f.bField}`;
    expect(fl?.v).toBeNull();
  });

  it("Trả lại sau khi đối tác đã ký một tệp ⇒ bản bị void, ô mở lại, link 410, bản ký có run_id của lượt", async () => {
    const f = await fixture({ second: true });
    const token = await invite(f.id);
    expect(
      (await call("POST", "/quick-signature", token, { method: "draw", png: PNG_B64 })).status,
    ).toBe(200);
    const r = await call("POST", "/sign", token, {
      file_id: f.fileId,
      marks: [fieldMark(f.bField)],
    });
    expect(r.json).toMatchObject({ completed: false, open_fields_left: 1 });
    const [v] = await o<
      { run: string }[]
    >`select run_id::text as run from contracts.sign_versions where contract_id = ${f.id}`;
    expect(v?.run).toBe(RUN);
    await withSystemScope(db, { kind: "system" }, (tx) =>
      signOnBack(tx, { tenantId: T, runId: RUN, since: null }),
    );
    const [after] = await o<{ voided: boolean; open: boolean }[]>`select
      (select voided_at is not null from contracts.sign_versions where contract_id = ${f.id}) as voided,
      (select signed_version_id is null from contracts.sign_fields where id = ${f.bField}) as open`;
    expect(after).toMatchObject({ voided: true, open: true });
    expect((await call("GET", "", token)).status).toBe(410);
    const again = await call("POST", "/sign", token, {
      file_id: f.fileId,
      marks: [fieldMark(f.bField)],
    });
    expect(again.status).toBe(410);
  });

  it("hai tệp Lưu song song ⇒ link được chốt đúng một lần, hợp đồng hoàn tất một lần", async () => {
    const f = await fixture({ second: true });
    const token = await invite(f.id);
    expect(
      (await call("POST", "/quick-signature", token, { method: "type", png: PNG_B64 })).status,
    ).toBe(200);
    const before = completed;
    const [a, b] = await Promise.all([
      call("POST", "/sign", token, { file_id: f.fileId, marks: [fieldMark(f.bField)] }),
      call("POST", "/sign", token, { file_id: f.file2, marks: [fieldMark(f.b2Field)] }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const done = [a, b].filter((x) => (x.json as { completed: boolean }).completed);
    expect(done).toHaveLength(1);
    expect(completed).toBe(before + 1);
    const [l] = await o<
      { n: number }[]
    >`select count(*)::int as n from contracts.partner_sign_links where contract_id = ${f.id} and signed_at is not null`;
    expect(l?.n).toBe(1);
  });

  it("POST không có CSRF / khác nguồn ⇒ 403", async () => {
    const f = await fixture();
    const token = await invite(f.id);
    const res = await http.request(`/sign-link/${token}/decline`, {
      method: "POST",
      headers: { "x-forwarded-for": "10.9.9.9", "content-type": "application/json" },
      body: JSON.stringify({ reason: "x" }),
    });
    expect(res.status).toBe(403);
  });
});
