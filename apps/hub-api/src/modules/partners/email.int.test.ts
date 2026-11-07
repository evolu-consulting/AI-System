// CR-124 · q5 · FLOW4-FR-12/13 · NFR-01/02/03 · hub 0120 · đường email: token băm + hết hạn + dùng một lần + hạn mức + CSRF + cách ly bảng nhật ký.
// Role thật: `hub_api` (scope system như bộ gửi/trang công khai; scope user) và role gói `contracts_rw`. Mạng giả: transport email giả + PDF giả.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inHub, inPack, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql } from "@ai/test-kit/perf";
import { connectDb, type Db } from "../../lib/db";
import { logger } from "../../lib/logger";
import { FakeEmailTransport } from "../notify/adapters/transport.fake";
import type { PartnerMailboxPort } from "../packs/kit/public";
import { partnerPublicRoutes } from "./adapters/partner-public.routes";
import { windowLimit } from "./adapters/window-limit";
import { hashHex, sha256Hex } from "./domain/email-link.rules";
import { partnerEmailOnce } from "./email-dispatch";
import { partnerMoveOnce } from "./mailbox-mover";
import { publicStore } from "./partners.public.mount";

const A = tenantId(1401);
const B = tenantId(1402);
const UA = userId(1401);
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
let o: Sql;
let db: Db;
const client = (): Sql => (db.db as unknown as { $client: Sql }).$client;

const port: PartnerMailboxPort = {
  receive: async () => 0,
  onReplies: async () => undefined,
  pdf: async (t) => (t === A ? { bytes: PDF, name: "hd.pdf" } : null),
};
const mail = new FakeEmailTransport();
const dispatch = () =>
  partnerEmailOnce({ db, email: () => mail, baseUrl: "https://app.test.vn", port: () => port });
const mk = () =>
  partnerPublicRoutes({
    store: publicStore(db),
    hops: 1, // XFF của test có đúng một IP (1 proxy tin cậy)
    limit: windowLimit({}),
    port: () => port,
    log: logger,
  });

let appInst: ReturnType<typeof mk> | undefined;
// MỘT bộ đếm hạn mức dùng chung (db gán ở beforeAll)
const theApp = {
  request: (u: string, i?: RequestInit) => {
    appInst ??= mk();
    return appInst.request(u, i);
  },
};
const asA = <T>(fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: A, userId: UA }, fn);
const sendEmail = (to = "lienhe@congty-b.vn", ref = "hd-1") =>
  asA(
    (tx) => tx`select hub.partner_send(${A}::uuid, null, ${to}, 'email', ${ref},
      '{"title":"HĐ mua bán lô 7","message":"Xin xác nhận","importance_hint":"auto","fields":{"total_value":600000000}}'::jsonb,
      ${"3f2b8c10-0000-4000-8000-000000000001"}, null, now() + interval '7 days', null)::text as id`,
  ).then((r) => r[0]?.id as string);
const tokenOf = (m: { text: string }) =>
  /\/partner-reply\/([A-Za-z0-9_-]{43})/.exec(m.text)?.[1] as string;
const row = (id: string) =>
  o<
    {
      status: string;
      outcome: string | null;
      source: string | null;
      token_hash: Buffer | null;
      expires_at: Date;
      evidence: Record<string, unknown> | null;
    }[]
  >`select status, outcome, replied_by_source as source, token_hash, expires_at, evidence from hub.partner_mailbox where id = ${id}`.then(
    (r) => r[0] as NonNullable<(typeof r)[0]>,
  );

/** Gửi 1 thư và trả về token trong link (dùng một lần cho mỗi ca). */
async function emailed(to?: string, ref?: string) {
  const id = await sendEmail(to, ref);
  const before = mail.sent.length;
  await dispatch();
  const msg = mail.sent.at(before);
  return { id, token: tokenOf(msg as { text: string }), msg: msg as (typeof mail.sent)[number] };
}

const get = (t: string, path = "", ip = "203.0.113.5") =>
  theApp.request(`/${t}${path}`, { headers: { "x-forwarded-for": ip, "user-agent": "bun-test" } });
const post = (
  t: string,
  form: Record<string, string>,
  cookie: string | null,
  h: Record<string, string> = {},
) =>
  theApp.request(`/${t}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "203.0.113.6",
      ...(cookie ? { cookie: `prc=${cookie}` } : {}),
      ...h,
    },
    body: new URLSearchParams(form).toString(),
  });
const csrfOf = async (res: Response) => ({
  cookie: /prc=([0-9a-f]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] as string,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed, directory_verified_at)
    values (${A}, 'q5-a', 'A', 'Công ty A', '0100000011', true, null), (${B}, 'q5-b', 'B', 'Công ty B', '0100000012', false, null)`;
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-124 q5 · bộ gửi email + token băm", () => {
  it("gửi một thư tiếng Việt có link, DB chỉ giữ băm token (không bản rõ), chạy lại không gửi đôi", async () => {
    const { id, token, msg } = await emailed();
    expect(msg.subject).toContain("Công ty A đề nghị xác nhận hợp đồng");
    expect(msg.text).toContain("Hạn trả lời");
    expect(msg.html).toContain("Xem hợp đồng và trả lời");
    const r = await row(id);
    expect(r.status).toBe("delivered");
    expect(Buffer.from(r.token_hash as Buffer).toString("hex")).toBe(await hashHex(token));
    // bản rõ không nằm ở bất kỳ cột nào của dòng hộp thư / nhật ký
    const dump =
      await o`select (select row_to_json(m)::text from hub.partner_mailbox m where m.id = ${id}) ||
      coalesce((select string_agg(row_to_json(e)::text, '') from hub.partner_email_events e where e.mailbox_id = ${id}), '') as t`;
    expect(String(dump[0]?.t)).not.toContain(token);
    const calls = mail.sent.length;
    await dispatch();
    expect(mail.sent.length).toBe(calls);
    const ev =
      await o`select event, pdf_sha256 from hub.partner_email_events where mailbox_id = ${id}`;
    expect(ev.map((e) => e.event)).toEqual(["sent"]);
    expect(ev[0]?.pdf_sha256).toBe(await sha256Hex(PDF));
  });

  it("perf: số câu SQL của bộ gửi cố định (2 dòng = 40 dòng)", async () => {
    for (let i = 0; i < 2; i++) await sendEmail("a@b.vn", `s-${i}`);
    const small = (await captureSql(client(), dispatch)).queries.length;
    for (let i = 0; i < 40; i++) await sendEmail("a@b.vn", `b-${i}`);
    const big = (await captureSql(client(), dispatch)).queries.length;
    console.log(`perf partner email dispatch: câu SQL/lô 2 dòng=${small} 40 dòng=${big}`);
    expect(big).toBe(small);
    expect(big).toBeLessThanOrEqual(8);
  });
});

describe("CR-124 q5 · trang công khai: xem, trả lời, dùng một lần", () => {
  it("mở link: đúng một hợp đồng + PDF, Xác nhận ⇒ partner.confirmed vào tenant GỬI, gửi lại không phát đôi", async () => {
    const { id, token } = await emailed();
    const page = await get(token);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("HĐ mua bán lô 7");
    expect(html).toContain("600.000.000");
    expect(html).toContain("Chưa xác minh");
    expect(html).not.toContain(A); // không lộ id nội bộ
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(html).toContain('name="robots" content="noindex');
    const pdf = await get(token, "/pdf");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await pdf.arrayBuffer()).length).toBe(PDF.length);

    const { cookie } = await csrfOf(page);
    const form = {
      csrf: cookie,
      action: "confirm",
      name: "Trần Văn B",
      title: "Giám đốc",
      reason: "",
    };
    const res = await post(token, form, cookie);
    expect(res.status).toBe(303);
    const r = await row(id);
    expect([r.status, r.outcome, r.source]).toEqual(["replied", "confirmed", "email"]);
    expect(r.evidence).toMatchObject({
      actor_name: "Trần Văn B",
      actor_title: "Giám đốc",
      via: "email_link",
    });
    // cùng đường q3: bộ chuyển phát partner.confirmed (không cổng gói ⇒ đường q1 `emitReplies`)
    await partnerMoveOnce({ db });
    const ev =
      await o`select event, tenant_id::text, ref from hub.flow_events where event_id = ${`partner:${id}:reply`}`;
    expect(ev).toHaveLength(1);
    expect([ev[0]?.event, ev[0]?.tenant_id, ev[0]?.ref]).toEqual(["partner.confirmed", A, "hd-1"]);
    // dùng lại: cùng kết quả ⇒ không ghi đôi; kết quả khác ⇒ không đổi; trang hiện "đã ghi nhận"
    expect((await post(token, form, cookie)).status).toBe(303);
    await post(token, { ...form, action: "decline", reason: "đổi ý" }, cookie);
    expect((await row(id)).outcome).toBe("confirmed");
    await partnerMoveOnce({ db });
    expect(
      await o`select 1 from hub.flow_events where event_id = ${`partner:${id}:reply`}`,
    ).toHaveLength(1);
    const again = await (await get(token)).text();
    expect(again).toContain("ý kiến đã được ghi nhận");
    expect(again).not.toContain('name="action"');
    // nhật ký: gửi → mở (IP /24) → trả lời (tên, chức vụ, băm PDF); bên GỬI đọc được qua hàm, B không
    const hist = await asA(
      (tx) =>
        tx`select event, ip_prefix, actor_name, actor_title, pdf_sha256 from hub.partner_email_history(${id}::uuid)`,
    );
    expect(hist.map((h) => h.event)).toContain("opened");
    expect(hist.find((h) => h.event === "opened")?.ip_prefix).toBe("203.0.113.0/24");
    const rep = hist.find((h) => h.event === "replied");
    expect([rep?.actor_name, rep?.actor_title, rep?.pdf_sha256]).toEqual([
      "Trần Văn B",
      "Giám đốc",
      await sha256Hex(PDF),
    ]);
    expect(
      await pgCode(() =>
        inHub(
          { kind: "user", tenantId: B, userId: userId(1402) },
          (tx) => tx`select * from hub.partner_email_history(${id}::uuid)`,
        ),
      ),
    ).toBe("42501");
  });

  it("Trả lại sửa cần lý do, thiếu họ tên bị chặn (422) và không ghi gì", async () => {
    const { id, token } = await emailed();
    const { cookie } = await csrfOf(await get(token));
    const noReason = await post(
      token,
      { csrf: cookie, action: "return", name: "Lê B", title: "GĐ", reason: "" },
      cookie,
    );
    expect(noReason.status).toBe(422);
    expect(await noReason.text()).toContain("cần ghi lý do");
    const noName = await post(
      token,
      { csrf: cookie, action: "confirm", name: "", title: "GĐ", reason: "" },
      cookie,
    );
    expect(noName.status).toBe(422);
    expect((await row(id)).status).toBe("delivered");
    const ok = await post(
      token,
      {
        csrf: cookie,
        action: "return",
        name: "Lê B",
        title: "Kế toán",
        reason: "sai đơn giá mục 3",
      },
      cookie,
    );
    expect(ok.status).toBe(303);
    const r = await o`select outcome, reason from hub.partner_mailbox where id = ${id}`;
    expect([r[0]?.outcome, r[0]?.reason]).toEqual(["returned", "sai đơn giá mục 3"]);
  });

  it("CSRF: thiếu cookie, cookie lệch hoặc Sec-Fetch-Site cross-site ⇒ 403 và không ghi", async () => {
    const { id, token } = await emailed();
    const { cookie } = await csrfOf(await get(token));
    const f = { csrf: cookie, action: "confirm", name: "Trần B", title: "Giám đốc", reason: "" };
    expect((await post(token, f, null)).status).toBe(403);
    expect((await post(token, f, "0".repeat(32))).status).toBe(403);
    expect((await post(token, f, cookie, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(token, { ...f, csrf: "" }, cookie)).status).toBe(403);
    expect((await row(id)).status).toBe("delivered");
  });

  it("hết hạn: link quá hạn ⇒ 410 chỉ hiện tên công ty gửi (không nội dung), không trả lời được", async () => {
    const { id, token } = await emailed();
    const { cookie } = await csrfOf(await get(token));
    await o`update hub.partner_mailbox set expires_at = now() - interval '1 hour' where id = ${id}`;
    const res = await get(token);
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain("Link đã hết hạn");
    expect(html).toContain("Công ty A");
    expect(html).not.toContain("HĐ mua bán lô 7");
    expect((await get(token, "/pdf")).status).toBe(404);
    await post(
      token,
      { csrf: cookie, action: "confirm", name: "Trần B", title: "GĐ", reason: "" },
      cookie,
    );
    expect((await row(id)).status).toBe("delivered");
    // quá 7 ngày sau hạn ⇒ như link sai
    await o`update hub.partner_mailbox set expires_at = now() - interval '8 days' where id = ${id}`;
    expect((await get(token)).status).toBe(404);
  });

  it("bên GỬI đã ghi nhận thủ công ⇒ link đóng, người dùng gói không gọi được hàm token", async () => {
    const { id, token } = await emailed();
    await asA(
      (tx) =>
        tx`select hub.partner_reply(${id}::uuid, 'declined', 'đã gọi điện', 'manual', '{"files":["x"]}'::jsonb)`,
    );
    expect((await get(token)).status).toBe(410);
    const th = await hashHex(token);
    expect(
      await pgCode(() =>
        inPack(
          "contracts",
          A,
          (tx) => tx`select * from hub.partner_email_view(decode(${th}, 'hex'), null, null, false)`,
        ),
      ),
    ).toBe("42501");
    expect(
      await pgCode(() =>
        asA(
          (tx) =>
            tx`select * from hub.partner_email_view(decode(${"00".repeat(32)}, 'hex'), null, null, false)`,
        ),
      ),
    ).toBe("42501");
    expect(
      await pgCode(() =>
        asA((tx) => tx`select hub.partner_reply(${id}::uuid, 'confirmed', null, 'email', null)`),
      ),
    ).toBe("0A000");
  });
});

describe("CR-124 q5 · hạn mức", () => {
  it("quá 30 lần mở/giờ/token ⇒ 429 + Retry-After, 10 link sai/IP ⇒ khoá IP", async () => {
    const { token } = await emailed();
    // 10 IP khác nhau để không chạm hạn mức IP (60/phút)
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await get(token, "", `198.51.100.${i % 200}`)).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    const last = await get(token, "", "198.51.100.250");
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
    const bad = "x".repeat(43);
    for (let i = 0; i < 10; i++) expect((await get(bad, "", "192.0.2.77")).status).toBe(404);
    expect((await get(bad, "", "192.0.2.77")).status).toBe(429);
    expect((await get("short", "", "192.0.2.78")).status).toBe(404);
  });
});

describe("CR-124 q5 · cách ly + hiệu năng đường trả lời", () => {
  it("hub.partner_email_events: role gói và scope user không đọc/ghi thẳng bảng (NFR-01)", async () => {
    const { id } = await emailed();
    expect(
      await pgCode(() =>
        inPack("contracts", A, (tx) => tx`select 1 from hub.partner_email_events`),
      ),
    ).toBe("42501");
    expect(
      await asA((tx) => tx`select 1 from hub.partner_email_events`).catch(() => "denied"),
    ).toSatisfy((v: unknown) => v === "denied" || (Array.isArray(v) && v.length === 0));
    expect(
      await pgCode(() =>
        asA(
          (tx) =>
            tx`insert into hub.partner_email_events (mailbox_id, event) values (${id}::uuid, 'opened')`,
        ),
      ),
    ).not.toBeNull();
    expect(
      await pgCode(() =>
        inPack("contracts", B, (tx) => tx`select * from hub.partner_email_history(${id}::uuid)`),
      ),
    ).toBe("42501");
  });

  it("đường trả lời: số câu SQL cố định (1 lần gọi hàm), không phụ thuộc kích thước", async () => {
    const { token } = await emailed();
    const { cookie } = await csrfOf(await get(token));
    const f = {
      csrf: cookie,
      action: "confirm",
      name: "Trần Văn B",
      title: "Giám đốc",
      reason: "",
    };
    const n = (await captureSql(client(), async () => post(token, f, cookie))).queries.length;
    console.log(`perf partner email reply: câu SQL/lần trả lời=${n}`);
    expect(n).toBeLessThanOrEqual(4); // BEGIN + set_config scope + hàm + COMMIT
  });
});
