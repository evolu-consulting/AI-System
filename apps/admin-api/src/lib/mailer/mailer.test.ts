// CR-121 c21b · unit mailer admin-api: gửi QUA Hub (`POST /internal/mail`) — Hub giả lập bằng Bun.serve (ranh giới HTTP thật, không SMTP).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createMailer, createMemoryMailer, MailError } from "./index";

const TOKEN = "t".repeat(40);
type Seen = { auth: string | null; body: unknown };
let seen: Seen[] = [];
let mode: "ok" | "not_configured" | "fail" = "ok";
let server: ReturnType<typeof Bun.serve>;
let url = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      seen.push({ auth: req.headers.get("authorization"), body: await req.json() });
      if (mode === "not_configured")
        return Response.json({ error: { code: "NOT_CONFIGURED", message: "x" } }, { status: 409 });
      if (mode === "fail")
        return Response.json(
          { error: { code: "MAIL_SEND_FAILED", message: "x" } },
          { status: 502 },
        );
      return Response.json({ sent: 1, skipped: 0 });
    },
  });
  url = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

const msg = { to: ["a@corp.vn"], subject: "Đã dùng 80%", text: "nội dung" };

describe("mailer (qua Hub)", () => {
  it("memory mailer cũng kiểm hợp lệ trước khi ghi", async () => {
    const mem = createMemoryMailer();
    await expect(mem.send({ to: ["x"], subject: "s", text: "t" })).rejects.toBeInstanceOf(
      MailError,
    );
    expect(mem.sent).toHaveLength(0);
  });

  it("gửi: POST /internal/mail kèm Bearer token dịch vụ, thân {to, subject, text}", async () => {
    seen = [];
    mode = "ok";
    await createMailer({ url: `${url}/`, token: TOKEN }).send(msg);
    expect(seen).toEqual([{ auth: `Bearer ${TOKEN}`, body: msg }]);
  });

  it("Hub 409 NOT_CONFIGURED ⇒ MAIL_DISABLED, Hub 502/lỗi mạng ⇒ MAIL_SEND_FAILED", async () => {
    mode = "not_configured";
    await expect(createMailer({ url, token: TOKEN }).send(msg)).rejects.toMatchObject({
      code: "MAIL_DISABLED",
    });
    mode = "fail";
    await expect(createMailer({ url, token: TOKEN }).send(msg)).rejects.toMatchObject({
      code: "MAIL_SEND_FAILED",
    });
    await expect(
      createMailer({ url: "http://127.0.0.1:1", token: TOKEN }).send(msg),
    ).rejects.toMatchObject({ code: "MAIL_SEND_FAILED" });
  });

  it("thiếu URL hoặc token ⇒ MAIL_DISABLED, không gọi mạng", async () => {
    seen = [];
    await expect(createMailer({ token: TOKEN }).send(msg)).rejects.toMatchObject({
      code: "MAIL_DISABLED",
    });
    await expect(createMailer({ url }).send(msg)).rejects.toMatchObject({ code: "MAIL_DISABLED" });
    expect(seen).toHaveLength(0);
  });

  it("thư không hợp lệ (địa chỉ sai, CRLF trong chủ đề, html quá 100 KB) ⇒ MAIL_INVALID trước khi gọi Hub", async () => {
    seen = [];
    const m = createMailer({ url, token: TOKEN });
    for (const bad of [
      { ...msg, to: ["x"] },
      { ...msg, subject: "a\r\nBcc: z@z.vn" },
      { ...msg, html: "x".repeat(100 * 1024 + 1) },
    ])
      await expect(m.send(bad)).rejects.toMatchObject({ code: "MAIL_INVALID" });
    expect(seen).toHaveLength(0);
  });
});
