// ADM-FR-41 · unit test mailer (không mạng).
import { describe, expect, it } from "bun:test";
import { createMailer, createMemoryMailer, MailError } from "./index";

describe("mailer", () => {
  it("memory mailer cũng kiểm hợp lệ trước khi ghi", async () => {
    const mem = createMemoryMailer();
    await expect(mem.send({ to: ["x"], subject: "s", text: "t" })).rejects.toBeInstanceOf(
      MailError,
    );
    expect(mem.sent).toHaveLength(0);
  });
  it("html quá 100 KB bị chặn", async () => {
    const m = createMailer({ SMTP_URL: "smtp://127.0.0.1:1" });
    const html = "x".repeat(100 * 1024 + 1);
    await expect(m.send({ to: ["a@b.test"], subject: "s", text: "t", html })).rejects.toMatchObject(
      {
        code: "MAIL_INVALID",
      },
    );
  });
});
