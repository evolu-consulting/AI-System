// V2-G · BA v2 §3.1 HD-02/HD-08 · §4.2 "Upload và xác nhận": AI đọc HĐ v2 qua hub-api THẬT với agent GIẢ tất định (không AI thật):
// loại HĐ (Mua/Bán/Giới thiệu) + trường chưa chắc + tóm tắt 5 mục + mốc tìm thấy được lưu (`contracts.ai_read`) và trả ở chi tiết;
// loại AI đoán chỉ điền khi HĐ chưa có loại (người đã chọn thì giữ); bản trích cũ (không khoá v2) giữ nguyên hành vi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { CtxHd2 } from "../HD2/_support/hd2";
import {
  agentJson,
  agentV2,
  arrangeV2a,
  C1_TEXT,
  CBASE,
  cid,
  detail,
  insContract,
  type Json,
  needV2g,
  P,
  restoreApproval,
  rowsOf,
  SUMMARY,
  setApproval,
  startHd2,
  T,
  V2G_TEXT,
} from "./_support/v2g";

let c: CtxHd2;
beforeAll(async () => {
  c = await startHd2();
  await needV2g(c.sql);
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const FIELDS = {
  number: { value: "01/2026/HĐMB-PN", quote: "HỢP ĐỒNG MUA BÁN số 01/2026/HĐMB-PN" },
  supplier_name: {
    value: "Công ty TNHH Bao Bì Phương Nam",
    quote: "Bên bán: Công ty TNHH Bao Bì Phương Nam",
  },
  buyer_name: {
    value: "Công ty Cổ phần Thực phẩm An Khang",
    quote: "Bên mua: Công ty Cổ phần Thực phẩm An Khang",
  },
  start_date: { value: "2026-01-01", quote: "từ ngày 01/01/2026" },
  end_date: { value: "2026-12-30", quote: "đến hết ngày 31/12/2026" }, // sai ngày ⇒ verified=false
  total_value: { value: 245_000_000, quote: "Tổng giá trị hợp đồng: 245.000.000 đồng" },
  payment_terms: { value: "Đợt 1 trước 15/02/2026", quote: "Đợt 1: thanh toán 100.000.000 đồng" },
};
const MILESTONES = [
  {
    kind: "pay",
    title: "Thanh toán đợt 1",
    due_date: "2026-02-15",
    amount: 100_000_000,
    quote: "thanh toán 100.000.000 đồng trước ngày 15/02/2026",
  },
  {
    kind: "delivery",
    title: "Giao lô đầu",
    due_date: null,
    amount: null,
    quote: "giao ngay tuần sau",
  },
];

const arrange = async () => {
  await arrangeV2a(c);
  await setApproval(c.sql, T.acme, false);
  c.ai.reset();
};
const read = async (
  script: string,
  o: { n?: number; deal?: "buy" | "sell" | "referral" | null; text?: string; fields?: Json } = {},
) => {
  const id = cid(o.n ?? 1);
  await insContract(c.sql, {
    id,
    tenant: T.acme,
    status: "extract_failed",
    source: o.text ?? V2G_TEXT,
    createdBy: P.hoa.id,
    owner: P.hoa.id,
    ...(o.fields ? { fields: o.fields } : {}),
  });
  if (o.deal)
    await c.sql`update contracts.contracts set deal = ${o.deal},
      direction = ${o.deal === "buy" ? "purchase" : "sale"} where id = ${id}`;
  c.ai.script = () => ({ ok: true, text: script });
  const done = c.ai.settled(id);
  const r = await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/extract`);
  expect(r.status).toBe(202);
  expect(await done).toBe("needs_review");
  return { id, d: await detail(c, id) };
};

describe("V2-G · HD-02 AI đọc: loại + chưa chắc + tóm tắt + mốc", () => {
  it("Bán: lưu loại + hướng; chưa chắc = AI báo ∪ trích dẫn sai ∪ loại Mua/Bán; tóm tắt 5 mục; mốc kèm cờ verified", async () => {
    await arrange();
    const { id, d } = await read(
      agentV2(FIELDS, [], {
        deal: "sell",
        unsure: ["payment_terms"],
        summary: SUMMARY,
        milestones: MILESTONES,
      }),
    );
    expect([d.deal, d.direction, d.status]).toEqual(["sell", "sale", "needs_review"]);
    expect(d.ai.deal).toBe("sell");
    expect(d.ai.unsure).toEqual(["end_date", "payment_terms", "deal"]);
    expect(d.ai.summary).toEqual(SUMMARY);
    expect(d.ai.milestones).toEqual([
      { ...MILESTONES[0], verified: true },
      { ...MILESTONES[1], verified: false },
    ]);
    expect(d.fields.end_date.verified).toBe(false);
    // Mốc AI tìm thấy chỉ NẰM trong `ai_read` tới khi người bấm Lưu — chưa có mốc nào trong sổ.
    expect((await rowsOf(c.sql, id)).length).toBe(0);
    // Lời nhắc gửi agent nêu 4 khoá mới (văn bản vẫn là dữ liệu).
    const sys = c.ai.calls.at(-1)?.system ?? "";
    for (const k of ["deal:", "unsure:", "summary:", "milestones:"]) expect(sys).toContain(k);
  });

  it("Mua ⇒ hướng purchase; Giới thiệu ⇒ hướng sale và KHÔNG chưa chắc về loại (trừ khi AI tự báo)", async () => {
    await arrange();
    const buy = await read(agentV2(FIELDS, [], { deal: "buy" }), { n: 1 });
    expect([buy.d.deal, buy.d.direction]).toEqual(["buy", "purchase"]);
    expect(buy.d.ai.unsure).toContain("deal");
    const ref = await read(agentV2(FIELDS, [], { deal: "referral" }), { n: 2 });
    expect([ref.d.deal, ref.d.direction]).toEqual(["referral", "sale"]);
    expect(ref.d.ai.unsure).not.toContain("deal");
    const unsure = await read(agentV2(FIELDS, [], { deal: "referral", unsure: ["deal"] }), {
      n: 3,
    });
    expect(unsure.d.ai.unsure).toContain("deal");
  });

  it("bản trích cũ (không khoá v2) ⇒ `ai` null, loại chưa chọn (như trước V2-G)", async () => {
    await arrange();
    const { d } = await read(agentJson(FIELDS, []));
    expect([d.ai, d.deal, d.direction]).toEqual([null, null, null]);
  });

  it("loại AI đoán chỉ điền khi HĐ chưa có loại: người đã chọn Mua thì đọc lại vẫn Mua (ai.deal vẫn là ý AI)", async () => {
    await arrange();
    const { d } = await read(agentV2(FIELDS, [], { deal: "sell" }), { deal: "buy" });
    expect([d.deal, d.direction, d.ai.deal]).toEqual(["buy", "purchase", "sell"]);
  });

  it("đọc lại: trường người đã sửa không còn chưa chắc và không bị đè", async () => {
    await arrange();
    const edited = {
      payment_terms: { value: "Trả 3 đợt", quote: "", verified: true, edited: true },
    };
    const { d } = await read(
      agentV2(FIELDS, [], { deal: "sell", unsure: ["payment_terms", "total_value"] }),
      { fields: edited },
    );
    expect(d.fields.payment_terms).toMatchObject({ value: "Trả 3 đợt", edited: true });
    expect(d.ai.unsure).toEqual(["end_date", "total_value", "deal"]);
  });

  it("đầu ra v2 sai hình (mốc loại lạ) ⇒ extract_failed INVALID_OUTPUT, không ghi `ai_read`", async () => {
    await arrange();
    const id = cid(1);
    await insContract(c.sql, { id, tenant: T.acme, status: "extract_failed", source: C1_TEXT });
    c.ai.script = () => ({
      ok: true,
      text: agentV2(FIELDS, [], {
        milestones: [{ kind: "xx", title: null, due_date: null, amount: null, quote: "" }],
      }),
    });
    const done = c.ai.settled(id);
    await c.hubCall(P.hoa, "POST", `${CBASE}/${id}/extract`);
    expect(await done).toBe("extract_failed");
    const d = await detail(c, id);
    expect({ status: d.status, error: d.error, ai: d.ai }).toEqual({
      status: "extract_failed",
      error: "INVALID_OUTPUT",
      ai: null,
    });
  });

  it("tóm tắt rỗng-có-mục: lưu đúng 5 mục kể cả danh sách rỗng; tenant khác không thấy HĐ (404)", async () => {
    await arrange();
    const { id, d } = await read(
      agentV2(FIELDS, [], {
        summary: {
          main: "Chỉ có nội dung chính",
          deadlines: [],
          penalties: [],
          bonuses: [],
          clauses: [],
        },
      }),
    );
    expect(Object.keys(d.ai.summary).sort()).toEqual([
      "bonuses",
      "clauses",
      "deadlines",
      "main",
      "penalties",
    ]);
    expect((await c.hubCall(P.an, "GET", `${CBASE}/${id}`)).status).toBe(404);
  });
});
