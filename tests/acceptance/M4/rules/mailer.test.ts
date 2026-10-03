// ADM-FR-40 (hạ tầng cảnh báo quota R05) · ADM-FR-08 · `lib/mailer` (test-plan-cd §1.4, plan-cd §9, TM). Xanh ở TM.
// Không kết nối mạng: ca MAIL_INVALID phải bị chặn TRƯỚC khi kết nối (cổng 1 đóng → nếu kết nối thì ra MAIL_SEND_FAILED).
import { describe, expect, it } from "bun:test";
import { loadMailer } from "../_cd-modules";

const ok = { to: ["binh@acme.test"], subject: "[M4-qc] thử", text: "Xin chào" };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return String((e as { code?: string }).code);
  }
}

describe("ADM-FR-08 · lib/mailer", () => {
  it("ADM-FR-08 · M-R01 · D10 · không SMTP_URL → mailer tắt: send reject MailError MAIL_DISABLED", async () => {
    const m = await loadMailer();
    const mailer = m.createMailer({});
    let err: unknown;
    try {
      await mailer.send(ok);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(m.MailError);
    expect((err as { code: string }).code).toBe("MAIL_DISABLED");
  });

  it("ADM-FR-08 · M-R02 · chống header injection + giới hạn: mỗi ca reject MAIL_INVALID (kiểm trước khi kết nối)", async () => {
    const m = await loadMailer();
    const mailer = m.createMailer({ SMTP_URL: "smtp://127.0.0.1:1" });
    const bad = [
      { ...ok, subject: "a\r\nBcc: x@evil.test" },
      { ...ok, subject: "a\nb" },
      { ...ok, to: [] },
      { ...ok, to: Array.from({ length: 51 }, (_, i) => `u${i}@acme.test`) },
      { ...ok, to: ["not-an-email"] },
      { ...ok, subject: "x".repeat(201) },
      { ...ok, text: "x".repeat(100 * 1024 + 1) },
    ];
    for (const msg of bad) expect(await codeOf(mailer.send(msg))).toBe("MAIL_INVALID");
  });

  it("ADM-FR-08 · M-R03 · createMemoryMailer ghi lại thư đã gửi", async () => {
    const m = await loadMailer();
    const mem = m.createMemoryMailer();
    await mem.send(ok);
    expect(mem.sent).toEqual([ok]);
  });
});
