// W1 · "Việc của tôi": luật thuần gom bốn nguồn → danh sách có mức độ gấp (port `digest.py`: `_late`, sắp xếp `build`).
import { describe, expect, it } from "bun:test";
import { MYWORK_MAX, MYWORK_SOURCE_MAX } from "@ai/contracts";
import {
  buildMyWork,
  compareItems,
  deadlineItem,
  followupItem,
  genericFollowupItem,
  obligationItem,
  type RawDeadline,
  type RawFollowup,
  type RawMyWork,
  type RawObligation,
  reminderItem,
  toneOf,
} from "./mywork.rules";

const TODAY = "2026-10-20";
const ob = (id: string, due: string, direction: "pay" | "receive" = "pay"): RawObligation => ({
  id,
  contract_id: `c-${id}`,
  direction,
  amount: 1_000,
  due,
  number: `N-${id}`,
  title: `HĐ ${id}`,
  party: "Đối tác",
  contract_direction: direction === "pay" ? "purchase" : "sale",
});
const dl = (id: string, deadline: string): RawDeadline => ({
  id,
  deadline,
  number: null,
  title: `HĐ ${id}`,
  party: null,
  contract_direction: "purchase",
});
const fu = (id: string, due: string, at = `${due}T09:00`): RawFollowup => ({
  id,
  due,
  at,
  note: null,
  customer_id: "k1",
  customer_name: "Khách",
  subject: "customer",
});
const raw = (p: Partial<RawMyWork> = {}): RawMyWork => ({
  followups: [],
  gfollowups: [],
  obligations: [],
  deadlines: [],
  reminders: [],
  ...p,
});

describe("W1 · toneOf (`_late`)", () => {
  it("trễ ⇒ late, hôm nay ⇒ soon, còn ngày ⇒ dim", () => {
    expect([toneOf(3), toneOf(1), toneOf(0), toneOf(-1), toneOf(-7)]).toEqual([
      "late",
      "late",
      "soon",
      "dim",
      "dim",
    ]);
  });
});

describe("W1 · từng nguồn → hàng", () => {
  it("đợt: ngày trễ = hôm nay − hạn; mang hướng, tiền, HĐ", () => {
    expect(obligationItem(ob("a", "2026-10-17", "receive"), TODAY)).toMatchObject({
      id: "obligation:a",
      kind: "obligation",
      tone: "late",
      days: 3,
      direction: "receive",
      amount: 1_000,
      contract_id: "c-a",
      title: "HĐ a",
    });
  });
  it("hạn xử lý HĐ: còn 2 ngày ⇒ dim, days = −2; mở HĐ theo id của HĐ", () => {
    expect(deadlineItem(dl("k", "2026-10-22"), TODAY)).toMatchObject({
      id: "deadline:k",
      tone: "dim",
      days: -2,
      contract_id: "k",
    });
  });
  it("hẹn nhắc: ngày địa phương + giờ; chủ thể và tên khách đi theo", () => {
    expect(followupItem(fu("f", TODAY, `${TODAY}T08:30`), TODAY)).toMatchObject({
      tone: "soon",
      days: 0,
      at: `${TODAY}T08:30`,
      title: "Khách",
      customer_id: "k1",
      subject: "customer",
    });
  });
  it("hẹn nhắc chung: giữ tiêu đề máy chủ đặt, chủ thể, HĐ; xếp cùng nhóm hẹn nhắc", () => {
    const g = {
      id: "g",
      due: "2026-10-19",
      at: "2026-10-19T09:00",
      note: "n",
      title: "Thu Khách An 5.000.000 đ",
      subject: "obligation" as const,
      contract_id: "c1",
    };
    expect(genericFollowupItem(g, TODAY)).toMatchObject({
      id: "followup:g",
      kind: "followup",
      tone: "late",
      days: 1,
      title: "Thu Khách An 5.000.000 đ",
      subject: "obligation",
      contract_id: "c1",
      customer_id: null,
    });
    const out = buildMyWork(raw({ gfollowups: [g], obligations: [ob("o", "2026-10-19")] }), TODAY);
    expect(out.items.map((i) => i.id)).toEqual(["followup:g", "obligation:o"]);
  });
  it("nhắc hạn đã gửi: mang mốc (ngày) và luôn là sắp tới", () => {
    const r = reminderItem(
      {
        id: "r",
        contract_id: "c",
        deadline: "2026-11-15",
        milestone: 30,
        number: "N",
        title: null,
        party: "P",
        contract_direction: "sale",
      },
      TODAY,
    );
    expect(r).toMatchObject({ kind: "reminder", tone: "dim", milestone: 30, title: "N" });
    expect(r.days).toBeLessThan(0);
  });
});

describe("W1 · buildMyWork: thứ tự và đếm", () => {
  it("trễ → hôm nay → sắp tới; trong mỗi mức: hẹn nhắc, tiền (trả trước thu), hạn HĐ", () => {
    const out = buildMyWork(
      raw({
        followups: [fu("f1", TODAY)],
        obligations: [
          ob("recv", "2026-10-19", "receive"),
          ob("pay", "2026-10-19", "pay"),
          ob("fut", "2026-10-25"),
        ],
        deadlines: [dl("d1", "2026-10-18"), dl("d2", TODAY)],
      }),
      TODAY,
    );
    expect(out.items.map((i) => i.id)).toEqual([
      "obligation:pay",
      "obligation:recv",
      "deadline:d1",
      "followup:f1",
      "deadline:d2",
      "obligation:fut",
    ]);
    expect(out.counts).toEqual({ late: 3, today: 2, upcoming: 1 });
    expect(out.truncated).toBe(false);
    expect(out.today).toBe(TODAY);
  });
  it("cùng mức và loại: hạn sớm trước, rồi giờ, rồi id (ổn định)", () => {
    const out = buildMyWork(
      raw({
        followups: [
          fu("b", TODAY, `${TODAY}T10:00`),
          fu("a", TODAY, `${TODAY}T10:00`),
          fu("c", TODAY, `${TODAY}T08:00`),
        ],
      }),
      TODAY,
    );
    expect(out.items.map((i) => i.id)).toEqual(["followup:c", "followup:a", "followup:b"]);
  });
  it("compareItems là thứ tự toàn phần ổn định (a≠b ⇒ ≠ 0, đối xứng)", () => {
    const xs = [
      obligationItem(ob("1", "2026-10-19"), TODAY),
      obligationItem(ob("2", "2026-10-19"), TODAY),
      deadlineItem(dl("3", "2026-10-19"), TODAY),
    ];
    for (const a of xs)
      for (const b of xs)
        expect(Math.sign(compareItems(a, b))).toBe(a === b ? 0 : -Math.sign(compareItems(b, a)));
  });
  it("rỗng ⇒ danh sách rỗng, đếm 0", () => {
    expect(buildMyWork(raw(), TODAY)).toEqual({
      today: TODAY,
      items: [],
      counts: { late: 0, today: 0, upcoming: 0 },
      truncated: false,
    });
  });
});

describe("W1 · giới hạn", () => {
  it("một nguồn quá MYWORK_SOURCE_MAX hàng (đọc dư 1) ⇒ cắt về MAX + truncated", () => {
    const many = Array.from({ length: MYWORK_SOURCE_MAX + 1 }, (_, i) =>
      ob(String(i).padStart(4, "0"), "2026-10-19"),
    );
    const out = buildMyWork(raw({ obligations: many }), TODAY);
    expect(out.items.length).toBe(MYWORK_SOURCE_MAX);
    expect(out.truncated).toBe(true);
  });
  it("tổng vượt MYWORK_MAX ⇒ cắt về MAX, giữ phần gấp nhất, truncated", () => {
    const n = MYWORK_SOURCE_MAX;
    const mk = (p: string, due: string) =>
      Array.from({ length: n }, (_, i) => ob(`${p}${String(i).padStart(3, "0")}`, due));
    const out = buildMyWork(
      raw({
        obligations: mk("a", "2026-10-10"),
        deadlines: Array.from({ length: n }, (_, i) => dl(`d${i}`, "2026-10-10")),
        followups: Array.from({ length: n }, (_, i) => fu(`f${i}`, "2026-10-30")),
      }),
      TODAY,
    );
    expect(out.items.length).toBe(MYWORK_MAX);
    expect(out.truncated).toBe(true);
    expect(out.items.every((i) => i.tone === "late")).toBe(true); // 200 mục trễ đứng trước 100 mục sắp tới
  });
});
