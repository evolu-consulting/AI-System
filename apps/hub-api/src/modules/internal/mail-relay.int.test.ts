// CR-121 c21b · int (DB test, role hub_api): admin-api gửi mail QUA Hub — `POST /internal/mail` dùng cấu hình trong KHO SECRET (c21), không env.
//  - đường chính: kho có cấu hình ⇒ 200, transport nhận đúng host/from/mật khẩu từ kho, thư tới đúng người nhận;
//  - người gọi không phải dịch vụ admin (không token / token sai / JWT) ⇒ 401, KHÔNG gửi; Hub chưa có token ⇒ 503;
//  - kho trống ⇒ 409 NOT_CONFIGURED; thân sai ⇒ 400.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../lib/db";
import { hubCredentials } from "../notify/adapters/credentials";
import { mailConfigReader, seedMailSecret } from "../notify/adapters/mail-config";
import { createStoredSmtpTransport, type MailSender } from "../notify/adapters/smtp.transport";
import { parseHubSecretsKey, sealHubSecret } from "../secrets/secrets.crypto";
import { HubSecretReader } from "../secrets/secrets.use";
import { mountMailRelay } from "./mail-relay.routes";

const TOKEN = "s".repeat(40);
let o: Sql;
let db: Db;
const key = parseHubSecretsKey(randomBytes(32).toString("base64"));
type Sent = { from: string; to: string; subject: string; pass: string | undefined; host: string };
const sent: Sent[] = [];

function app(token: string | null = TOKEN): Hono {
  const creds = hubCredentials(
    db,
    new HubSecretReader({ db, key, log: { warn: () => {} } as never }),
  );
  const email = createStoredSmtpTransport(
    mailConfigReader(creds),
    (cfg, pass): MailSender => ({
      sendMail: async (m) => {
        sent.push({ from: m.from, to: m.to.address, subject: m.subject, pass, host: cfg.host });
      },
    }),
  );
  const a = new Hono();
  mountMailRelay(a, {
    token: token ?? undefined,
    send: (msgs) => email.sendBatch(msgs),
    log: { warn: () => {} },
  });
  return a;
}
const post = (a: Hono, body: unknown, auth?: string) =>
  a.request("/internal/mail", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const MAIL = { to: ["lan@corp.vn", "minh@corp.vn"], subject: "Đã dùng 80%", text: "nội dung" };
const codeOf = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`delete from hub.secrets where kind = 'smtp_password'`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 c21b · POST /internal/mail", () => {
  it("kho trống ⇒ 409 NOT_CONFIGURED (không gửi)", async () => {
    sent.length = 0;
    const r = await post(app(), MAIL, `Bearer ${TOKEN}`);
    expect(r.status).toBe(409);
    expect(await codeOf(r)).toBe("NOT_CONFIGURED");
    expect(sent).toHaveLength(0);
  });

  it("đường chính: kho có cấu hình ⇒ 200 {sent:2}, host/from/mật khẩu lấy từ kho", async () => {
    await seedMailSecret(db, (m, v) => sealHubSecret(key, m, v), {
      smtp: {
        host: "smtp.kho.test",
        port: 587,
        secure: false,
        user: "u",
        from: "AI <no-reply@kho.vn>",
      },
      password: "pw-trong-kho",
    });
    sent.length = 0;
    const r = await post(app(), MAIL, `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sent: 2, skipped: 0 });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(sent.map((s) => s.to)).toEqual(["lan@corp.vn", "minh@corp.vn"]);
    expect(sent[0]).toMatchObject({
      from: "AI <no-reply@kho.vn>",
      host: "smtp.kho.test",
      pass: "pw-trong-kho",
      subject: "Đã dùng 80%",
    });
  });

  it("người gọi không phải dịch vụ admin ⇒ 401, KHÔNG gửi (thiếu header, sai scheme, sai token, JWT)", async () => {
    sent.length = 0;
    for (const auth of [undefined, `Basic ${TOKEN}`, `Bearer ${"x".repeat(40)}`, "Bearer a.b.c"]) {
      const r = await post(app(), MAIL, auth);
      expect(r.status).toBe(401);
      expect(await codeOf(r)).toBe("UNAUTHORIZED");
    }
    expect(sent).toHaveLength(0);
  });

  it("Hub chưa cấu hình token dịch vụ ⇒ 503 kể cả khi gửi token, thân sai ⇒ 400", async () => {
    sent.length = 0;
    expect((await post(app(null), MAIL, `Bearer ${TOKEN}`)).status).toBe(503);
    const bad = [
      { ...MAIL, to: [] },
      { ...MAIL, subject: "a\r\nBcc: x" },
      { ...MAIL, html: "<b>" },
      "{không phải json",
    ];
    for (const b of bad) expect((await post(app(), b, `Bearer ${TOKEN}`)).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});
