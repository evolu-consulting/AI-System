// N3-FR-07 · ADR-0027 · transport live với stub (KHÔNG mạng): ánh xạ lỗi SMTP/push, lấy bí mật qua hàm, Message-ID/topic idempotency.
import { describe, expect, test } from "bun:test";
import type { EmailMessage, PushMessage } from "../domain/notify.rules";
import {
  createSmtpTransport,
  type MailSender,
  mapSmtpError,
  type SmtpConfig,
} from "./smtp.transport";
import { createWebPushTransport, mapPushError, type PushSender } from "./webpush.transport";

const cfg: SmtpConfig = {
  host: "smtp.test",
  port: 587,
  secure: false,
  user: "u@test",
  from: "Hop Dong <no-reply@corp.test>",
};
const mail = (to: string): EmailMessage => ({
  idempotencyKey: "n3-42",
  tenantId: "t1",
  to,
  toName: "Lan",
  subject: "Tiêu đề",
  text: "Nội dung",
});

describe("mapSmtpError", () => {
  test("5xx và EENVELOPE ⇒ vĩnh viễn; 4xx, mạng, EAUTH, 535 ⇒ thử lại", () => {
    expect(mapSmtpError({ responseCode: 550 })).toEqual({
      ok: false,
      permanent: true,
      code: "smtp_550",
    });
    expect(mapSmtpError({ code: "EENVELOPE" })).toMatchObject({
      permanent: true,
      code: "smtp_envelope",
    });
    expect(mapSmtpError({ responseCode: 451 })).toEqual({
      ok: false,
      permanent: false,
      code: "smtp_451",
    });
    expect(mapSmtpError({ code: "EAUTH", responseCode: 535 })).toMatchObject({
      permanent: false,
      code: "smtp_auth",
    });
    expect(mapSmtpError({ responseCode: 535 })).toMatchObject({ permanent: false });
    expect(mapSmtpError({ code: "ETIMEDOUT" })).toEqual({
      ok: false,
      permanent: false,
      code: "smtp_etimedout",
    });
    expect(mapSmtpError(null)).toMatchObject({ permanent: false, code: "smtp_error" });
  });
});

describe("createSmtpTransport (stub nodemailer)", () => {
  test("gửi từng tin với Message-ID theo khóa idempotency; kết quả theo thứ tự; lỗi một tin không ảnh hưởng tin khác", async () => {
    const sent: unknown[] = [];
    const sender: MailSender = {
      sendMail: async (m) => {
        if (m.to.address === "bad@x.test")
          throw Object.assign(new Error("no such user"), { responseCode: 550 });
        sent.push(m);
      },
    };
    let built = 0;
    let pwCalls = 0;
    const t = createSmtpTransport(
      cfg,
      async () => {
        pwCalls++;
        return "pw-from-store";
      },
      (c, pw) => {
        built++;
        expect(pw).toBe("pw-from-store");
        expect(c.host).toBe("smtp.test");
        return sender;
      },
    );
    const out = await t.sendBatch([mail("lan@x.test"), mail("bad@x.test")]);
    expect(out).toEqual([{ ok: true }, { ok: false, permanent: true, code: "smtp_550" }]);
    expect(sent[0]).toMatchObject({
      from: "Hop Dong <no-reply@corp.test>",
      to: { name: "Lan", address: "lan@x.test" },
      messageId: "<n3-42@corp.test>",
    });
    await t.sendBatch([mail("lan@x.test")]);
    expect({ built, pwCalls }).toEqual({ built: 1, pwCalls: 1 }); // dựng một lần, lấy mật khẩu một lần
  });
});

describe("createSmtpTransport · bí mật", () => {
  test("không cấu hình user ⇒ không lấy mật khẩu; lấy bí mật lỗi ⇒ ném (cả lô thử lại ở dispatch)", async () => {
    let pw = 0;
    const open = createSmtpTransport(
      { ...cfg, user: "" },
      async () => {
        pw++;
        return "x";
      },
      () => ({ sendMail: async () => {} }),
    );
    expect(await open.sendBatch([mail("a@x.test")])).toEqual([{ ok: true }]);
    expect(pw).toBe(0);
    const broken = createSmtpTransport(
      cfg,
      async () => {
        throw new Error("secret_missing");
      },
      () => ({ sendMail: async () => {} }),
    );
    await expect(broken.sendBatch([mail("a@x.test")])).rejects.toThrow("secret_missing");
  });
});

describe("mapPushError", () => {
  test("404/410 ⇒ đăng ký hết hạn (xóa); 400/413 ⇒ vĩnh viễn; 401/403/429/5xx/mạng ⇒ thử lại", () => {
    expect(mapPushError({ statusCode: 410 })).toEqual({
      ok: false,
      permanent: true,
      code: "push_410",
      gone: true,
    });
    expect(mapPushError({ statusCode: 404 })).toMatchObject({ gone: true, permanent: true });
    expect(mapPushError({ statusCode: 400 })).toEqual({
      ok: false,
      permanent: true,
      code: "push_400",
    });
    expect(mapPushError({ statusCode: 413 })).toMatchObject({ permanent: true });
    for (const s of [401, 403, 429, 500, 503])
      expect(mapPushError({ statusCode: s })).toEqual({
        ok: false,
        permanent: false,
        code: `push_${s}`,
      });
    expect(mapPushError({ code: "ECONNRESET" })).toEqual({
      ok: false,
      permanent: false,
      code: "push_econnreset",
    });
  });
});

describe("createWebPushTransport (stub web-push)", () => {
  const msg = (endpoint: string): PushMessage => ({
    idempotencyKey: "n3-7",
    tenantId: "t1",
    endpoint,
    p256dh: "k",
    auth: "a",
    payload: "{}",
  });
  const vapid = { publicKey: "BPub", subject: "mailto:a@corp.test" };

  test("gửi với VAPID + topic idempotency; 410 ⇒ gone; kết quả theo thứ tự", async () => {
    const calls: { endpoint: string; topic: string; priv: string }[] = [];
    const send: PushSender = async (sub, _p, o) => {
      calls.push({ endpoint: sub.endpoint, topic: o.topic, priv: o.vapidDetails.privateKey });
      if (sub.endpoint.endsWith("gone"))
        throw Object.assign(new Error("gone"), { statusCode: 410 });
    };
    const t = createWebPushTransport(vapid, async () => "vapid-private", send);
    const out = await t.sendBatch([msg("https://p.test/ok"), msg("https://p.test/gone")]);
    expect(out[0]).toEqual({ ok: true });
    expect(out[1]).toMatchObject({ ok: false, gone: true });
    expect(calls[0]).toEqual({
      endpoint: "https://p.test/ok",
      topic: "n3-7",
      priv: "vapid-private",
    });
  });

  test("thiếu khóa công khai hoặc khóa riêng ⇒ vĩnh viễn vapid_not_configured, không gọi mạng", async () => {
    let n = 0;
    const send: PushSender = async () => void n++;
    const a = createWebPushTransport(null, async () => "k", send);
    const b = createWebPushTransport(vapid, async () => undefined, send);
    for (const t of [a, b])
      expect(await t.sendBatch([msg("https://p.test/x")])).toEqual([
        { ok: false, permanent: true, code: "vapid_not_configured" },
      ]);
    expect(n).toBe(0);
  });
});
