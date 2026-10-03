// ADM-FR-08 · hạ tầng mail (plan-cd §9, D10; R05 dùng ở khối A) · gửi thật qua Mailpit (test-plan-cd §4, TM). Xanh ở TM.
// Mailpit dùng chung: tiêu đề có tiền tố `[M4-qc]`, chỉ xoá/lọc theo tiền tố đó.
import { beforeEach, describe, expect, it } from "bun:test";
import { captureLogs, mailpitClear, mailpitFind, mailpitMessage, PREFIX } from "./_cd";
import { loadMailer } from "./_cd-modules";

const SMTP = "smtp://127.0.0.1:1025";
const TO = "binh@acme.test";

beforeEach(async () => {
  await mailpitClear();
});

/** Chờ thư tới Mailpit theo điều kiện (có hạn chót), không sleep cố định. */
async function waitMail(subject: string, ms = 5000) {
  const end = performance.now() + ms;
  for (;;) {
    const found = await mailpitFind(subject);
    if (found.length > 0 || performance.now() > end) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("ADM-FR-08 · mailer SMTP (Mailpit)", () => {
  it("ADM-FR-08 · M-I01 · D10 · gửi qua SMTP: đúng 1 thư, To/From/Subject UTF-8/Text nguyên văn", async () => {
    const { createMailer } = await loadMailer();
    const subject = `${PREFIX} gửi thử`;
    const mailer = createMailer({ SMTP_URL: SMTP, MAIL_FROM: "AI System QC <qc@ai-system.local>" });
    await mailer.send({ to: [TO], subject, text: "Xin chào" });
    const found = await waitMail(subject);
    expect(found).toHaveLength(1);
    const msg = await mailpitMessage((found[0] as { ID: string }).ID);
    expect(msg.To.map((a: { Address: string }) => a.Address)).toEqual([TO]);
    expect(msg.From.Address).toBe("qc@ai-system.local");
    expect(msg.Subject).toBe(subject);
    expect(String(msg.Text).trim()).toBe("Xin chào");
  });

  it("ADM-FR-08 · M-I02 · không MAIL_FROM → From no-reply@ai-system.local, tên 'AI System'", async () => {
    const { createMailer } = await loadMailer();
    const subject = `${PREFIX} from mặc định`;
    await createMailer({ SMTP_URL: SMTP }).send({ to: [TO], subject, text: "x" });
    const found = await waitMail(subject);
    expect(found).toHaveLength(1);
    const msg = await mailpitMessage((found[0] as { ID: string }).ID);
    expect(msg.From).toMatchObject({ Address: "no-reply@ai-system.local", Name: "AI System" });
  });

  it("ADM-FR-08 · M-I03 · M-I04 · cổng đóng → reject MAIL_SEND_FAILED ≤ 15 s; log không chứa địa chỉ và nội dung thư", async () => {
    const { createMailer } = await loadMailer();
    const mailer = createMailer({ SMTP_URL: "smtp://127.0.0.1:1" });
    const body = "Noi dung bi mat M4-qc 7731";
    const cap = captureLogs();
    const t0 = performance.now();
    let code = "resolved";
    try {
      await mailer.send({ to: [TO], subject: `${PREFIX} cổng đóng`, text: body });
    } catch (e) {
      code = String((e as { code?: string }).code);
    } finally {
      cap.restore();
    }
    expect(code).toBe("MAIL_SEND_FAILED");
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(cap.text()).not.toContain(TO);
    expect(cap.text()).not.toContain(body);
  }, 20_000);
});
