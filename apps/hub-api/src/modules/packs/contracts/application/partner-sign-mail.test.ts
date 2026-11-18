// CR-182 · soát cuối #1 — link /ky/<token> đủ để ký thay đối tác ⇒ KHÔNG ghi ra log ở prod (chỉ `link_id`).
import { describe, expect, it } from "bun:test";
import { sendMail } from "./partner-sign-mail";

const to = { id: "c1", name: "Chị Lan", email: "lan@doitac.vn", partner_name: "ĐT" } as never;
const mk = (logLink: boolean) => {
  const logs: { m: string; f: Record<string, unknown> | undefined }[] = [];
  return {
    logs,
    d: {
      mailer: () => null,
      logLink: () => logLink,
      log: {
        info: (m: string, f?: Record<string, unknown>) => void logs.push({ m, f }),
        warn: (m: string, f?: Record<string, unknown>) => void logs.push({ m, f }),
      },
    },
  };
};
const msg = { subject: "Mời ký", text: "x" };
const URL = "https://app.test/ky/SECRETTOKEN";

describe("sendMail khi tắt thông báo (không có transport)", () => {
  it("bản dev/test: ghi link ra log để kiểm", async () => {
    const { d, logs } = mk(true);
    expect(await sendMail(d, "t", to, "k", msg, URL, "L1")).toBe(false);
    expect(JSON.stringify(logs)).toContain("SECRETTOKEN");
  });
  it("prod: chỉ ghi link_id, tuyệt không có token/link/email", async () => {
    const { d, logs } = mk(false);
    expect(await sendMail(d, "t", to, "k", msg, URL, "L1")).toBe(false);
    const s = JSON.stringify(logs);
    expect(s).not.toContain("SECRETTOKEN");
    expect(s).not.toContain("/ky/");
    expect(s).not.toContain("lan@doitac.vn");
    expect(s).toContain("L1");
  });
});
