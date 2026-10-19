// N3-FR-05 · N3-FR-06 · N3-FR-07 · luật thuần cổng thông báo.
import { describe, expect, test } from "bun:test";
import {
  BACKOFF_SEC,
  type Claimed,
  emailOf,
  MAX_ATTEMPTS,
  mergePush,
  pushOf,
  safeCode,
  settle,
  thrownResult,
} from "./notify.rules";

const fail = (permanent: boolean, code = "smtp_451") => ({ ok: false as const, permanent, code });
const claimed = (o: Partial<Claimed> = {}): Claimed => ({
  id: "42",
  tenantId: "t1",
  userId: "u1",
  channel: "email",
  attempts: 1,
  kind: "demo.note",
  title: "Hết hạn\r\nBcc: x@evil.test",
  body: "Nội dung",
  link: "/contracts/1",
  email: "lan@example.test",
  displayName: "Lan\nNguyen",
  locale: "vi",
  subs: [{ endpoint: "https://p.example/1", p256dh: "k", auth: "a" }],
  ...o,
});

describe("settle · backoff 1′ → 5′ → 30′ → 2h, tối đa 5 lần", () => {
  test("thành công ⇒ sent", () => {
    expect(settle(1, { ok: true })).toEqual({ outcome: "sent" });
  });
  test("lỗi tạm lần 1…4 ⇒ retry với độ trễ tăng dần", () => {
    const delays = [1, 2, 3, 4].map((n) => {
      const s = settle(n, fail(false));
      return s.outcome === "retry" ? s.delaySec : -1;
    });
    expect(delays).toEqual([...BACKOFF_SEC]);
  });
  test("lần thứ 5 vẫn hỏng ⇒ dead; lỗi vĩnh viễn ⇒ dead ngay lần 1", () => {
    expect(settle(MAX_ATTEMPTS, fail(false)).outcome).toBe("dead");
    expect(settle(1, fail(true, "smtp_550")).outcome).toBe("dead");
  });
});

describe("safeCode · mã lỗi không chứa nội dung", () => {
  test("chuẩn hóa, cắt 64, mặc định khi rỗng", () => {
    expect(safeCode("SMTP 451: Try again")).toBe("smtp_451_try_again");
    expect(safeCode("   ")).toBe("send_failed");
    expect(safeCode("x".repeat(100))).toHaveLength(64);
  });
  test("transport ném lỗi ⇒ retry, mã theo tên lỗi", () => {
    const r = thrownResult(new TypeError("kết nối tới lan@example.test hỏng"));
    expect(r).toEqual({ ok: false, permanent: false, code: "transport_TypeError" });
  });
});

describe("emailOf · chống chèn header", () => {
  test("tiêu đề/tên không còn xuống dòng; link thành URL tuyệt đối; khóa idempotency theo id bản gửi", () => {
    const m = emailOf(claimed(), "https://app.example/");
    expect(m.subject).toBe("Hết hạn Bcc: x@evil.test");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.toName).toBe("Lan Nguyen");
    expect(m.text).toBe("Nội dung\n\nhttps://app.example/contracts/1");
    expect(m.idempotencyKey).toBe("n3-42");
  });
  test("không link ⇒ chỉ nội dung", () => {
    expect(emailOf(claimed({ link: null }), "https://a").text).toBe("Nội dung");
  });
});

describe("pushOf / mergePush", () => {
  test("một tin mỗi đăng ký, payload cắt gọn", () => {
    const m = pushOf(
      claimed({
        subs: [
          { endpoint: "https://a", p256dh: "k", auth: "a" },
          { endpoint: "https://b", p256dh: "k", auth: "a" },
        ],
        body: "y".repeat(500),
      }),
    );
    expect(m.map((x) => x.endpoint)).toEqual(["https://a", "https://b"]);
    expect(JSON.parse(m[0]?.payload ?? "{}").body).toHaveLength(200);
  });
  test("ít nhất một nhận được ⇒ ok; toàn vĩnh viễn ⇒ permanent; có lỗi tạm ⇒ retry; rỗng ⇒ no_subscription", () => {
    expect(mergePush([fail(true), { ok: true }])).toEqual({ ok: true });
    expect(mergePush([fail(true, "a"), fail(true, "b")])).toEqual(fail(true, "a"));
    expect(mergePush([fail(true, "a"), fail(false, "b")])).toEqual(fail(false, "b"));
    expect(mergePush([])).toEqual({ ok: false, permanent: true, code: "no_subscription" });
  });
});
