// HD4-FR-01…03 · HD4-FR-07 · HD4-AC01/02/03: luật thuần hạn chót, trạng thái theo ngày, mốc nhắc, nội dung nhắc.
import { describe, expect, it } from "bun:test";
import {
  type DueContract,
  deadlineOf,
  messageOf,
  partnerOf,
  planReminder,
  statusOn,
} from "./deadline.rules";
import { atLocal, localDate } from "./local-time.rules";

const VN = "Asia/Ho_Chi_Minh";
const base: DueContract = {
  id: "c1",
  status: "active",
  kind: "contract",
  outcome: null,
  endDate: "2026-10-06",
  deadline: "2026-10-06",
  ownerUserId: "u1",
  number: "HĐ-1",
  direction: "purchase",
  seller: "Công ty A",
  buyer: "Công ty B",
  value: 1_500_000_000,
  autoRenew: false,
};

describe("HD4-FR-01 · deadlineOf ≡ contracts.deadline_of", () => {
  it("HD4-AC01 · notice 30 / rỗng / chuỗi số / lạ / ngoài khoảng / phụ lục", () => {
    expect(deadlineOf("contract", "2026-12-31", 30)).toBe("2026-12-01");
    expect(deadlineOf("contract", "2026-12-31", null)).toBe("2026-12-31");
    expect(deadlineOf("contract", "2026-12-31", "45")).toBe("2026-11-16");
    expect(deadlineOf("contract", "2026-12-31", "abc")).toBe("2026-12-31");
    expect(deadlineOf("contract", "2026-12-31", 5000)).toBe("2026-12-31");
    expect(deadlineOf("contract", "2026-12-31", -1)).toBe("2026-12-31");
    expect(deadlineOf("appendix", "2026-12-31", 30)).toBeNull();
    expect(deadlineOf("contract", null, 30)).toBeNull();
  });
});

describe("HD4-FR-02 · statusOn / múi giờ", () => {
  it("HD4-AC02 · ngày VN đổi lúc 17:00Z", () => {
    expect(localDate(new Date("2026-10-31T16:59:59Z"), VN)).toBe("2026-10-31");
    expect(localDate(new Date("2026-10-31T17:00:00Z"), VN)).toBe("2026-11-01");
    expect(atLocal("2026-11-01", "08:00", VN).toISOString()).toBe("2026-11-01T01:00:00.000Z");
    expect(atLocal("2026-03-29", "02:30", "Europe/Berlin").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    ); // khe DST
  });
  it("renewed/terminated theo outcome; expired sau end; expiring ≤ 60 ngày; chưa duyệt giữ nguyên", () => {
    const f = {
      status: "active" as const,
      kind: "contract",
      outcome: null,
      endDate: "2026-12-31",
      deadline: "2026-12-31",
    };
    expect(statusOn(f, "2026-10-31")).toBe("active");
    expect(statusOn(f, "2026-11-01")).toBe("expiring");
    expect(statusOn(f, "2027-01-01")).toBe("expired");
    expect(statusOn({ ...f, outcome: "renewed" }, "2027-01-01")).toBe("renewed");
    expect(statusOn({ ...f, outcome: "replaced" }, "2026-10-01")).toBe("terminated");
    expect(statusOn({ ...f, outcome: "negotiating" }, "2026-11-01")).toBe("expiring");
    expect(statusOn({ ...f, status: "needs_review" }, "2027-01-01")).toBe("needs_review");
    expect(statusOn({ ...f, kind: "appendix" }, "2027-01-01")).toBe("active");
  });
});

describe("HD4-FR-03 · planReminder", () => {
  it("HD4-AC03 · còn 5 ngày lúc 10:00 VN ⇒ mốc 7, việc kế = mốc 1 lúc 08:00 VN", () => {
    const p = planReminder(base, new Date("2026-10-01T03:00:00Z"), VN);
    expect(p).toMatchObject({
      status: "expiring",
      changed: true,
      reminder: { milestone: 7, deadline: "2026-10-06", userId: "u1" },
    });
    expect(p.nextAt?.toISOString()).toBe("2026-10-05T01:00:00.000Z");
  });
  it("trước 08:00 ngày mốc chưa tới; handled / không người phụ trách ⇒ không nhắc; renewed ⇒ hết lịch", () => {
    const early = planReminder(
      { ...base, deadline: "2026-10-08", endDate: "2026-10-08" },
      new Date("2026-10-01T00:59:00Z"),
      VN,
    );
    expect(early.reminder?.milestone).toBe(30); // mốc 7 chưa tới (01:00Z) ⇒ mốc nhỏ nhất đã tới là 30
    expect(early.nextAt?.toISOString()).toBe("2026-10-01T01:00:00.000Z");
    expect(
      planReminder({ ...base, outcome: "negotiating" }, new Date("2026-10-01T03:00:00Z"), VN)
        .reminder,
    ).toBeNull();
    expect(
      planReminder({ ...base, ownerUserId: null }, new Date("2026-10-01T03:00:00Z"), VN).reminder,
    ).toBeNull();
    const r = planReminder({ ...base, outcome: "renewed" }, new Date("2026-10-01T03:00:00Z"), VN);
    expect([r.status, r.nextAt, r.reminder]).toEqual(["renewed", null, null]);
  });
  it("quá hạn ⇒ expired, mốc 0 'quá N ngày', không còn việc", () => {
    const p = planReminder(
      { ...base, endDate: "2026-09-20", deadline: "2026-09-20" },
      new Date("2026-10-01T03:00:00Z"),
      VN,
    );
    expect([p.status, p.reminder?.milestone, p.nextAt]).toEqual(["expired", 0, null]);
    expect(p.reminder?.body).toContain("quá 11 ngày");
  });
});

describe("HD4-FR-07 · nội dung", () => {
  it("tiêu đề/thân/link; đối tác theo phía; cắt độ dài theo CHECK N3", () => {
    const m = messageOf(base, 5);
    expect(m.title).toBe("Hợp đồng HĐ-1 — hạn chót hành động 06/10/2026");
    expect(m.body).toContain("với Công ty A cần được xử lý (còn 5 ngày)");
    expect(m.body).toContain("Giá trị: 1.500.000.000 đ");
    expect(m.link).toBe("/contracts/c1");
    expect(partnerOf({ direction: "sale", seller: "A", buyer: "B" })).toBe("B");
    expect(partnerOf({ direction: null, seller: "A", buyer: null })).toBe("A → —");
    const long = messageOf({ ...base, number: "x".repeat(2000), seller: "y".repeat(3000) }, 0);
    expect(long.title.length).toBeLessThanOrEqual(200);
    expect(long.body.length).toBeLessThanOrEqual(2000);
    expect(long.body).toContain("(hôm nay)");
  });
});
