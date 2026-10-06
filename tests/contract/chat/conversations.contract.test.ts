// CHAT-AC-05, 09, 18–23, 31 · E5–E11 hội thoại (plan C1 §2.4, §2.6, §3.5; test-plan §4 conversations).

import { describe, expect, it } from "bun:test";
import {
  CHAT_TITLE_MAX,
  ChatPageSchema,
  type Conversation,
  ConversationSchema,
  deriveTitle,
  FlowSchema,
  MessageSchema,
} from "@ai/contracts/chat";
import {
  call,
  expectChatError,
  expectStatus,
  lazySession,
  newConv,
  okJson,
  send,
  titles,
  UNKNOWN_UUID,
} from "./_client";
import { isMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const minh = lazySession(USERS.seeded);
const title = titles();
const ConvPage = ChatPageSchema(ConversationSchema);
const FlowPage = ChatPageSchema(FlowSchema);
const MessagePage = ChatPageSchema(MessageSchema);

async function listConvs(token: string, query = "limit=200"): Promise<Conversation[]> {
  const res = await call("GET", `/conversations?${query}`, { token });
  return (await okJson(res, 200, ConvPage, `GET /conversations?${query}`)).items;
}

async function getConv(token: string, id: string): Promise<Conversation> {
  return okJson(
    await call("GET", `/conversations/${id}`, { token }),
    200,
    ConversationSchema,
    "GET /conversations/:id",
  );
}

describe("HUB-FR-40 · conversations · tạo, đọc, đổi tên, xoá (E6–E9)", () => {
  it("CHAT-AC-18 · E6 tạo → 201 Conversation flow_count=0; E7 trả bằng hệt [K-C1]", async () => {
    const { access } = await lan();
    const t = title("Báo giá");
    const created = await newConv(access, t);
    expect(created.title).toBe(t);
    expect(created.flow_count).toBe(0);
    expect(await getConv(access, created.id)).toEqual(created);
  });

  it("CHAT-AC-21 · E8 đổi tên → 200, updated_at không lùi, E5 thấy tên mới, tiêu đề flow không đổi [K-C2]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Báo giá"));
    await send(access, conv.id, "Câu đầu để có flow");
    const before = await getConv(access, conv.id);
    const t = title("Báo giá đổi tên");
    const res = await call("PATCH", `/conversations/${conv.id}`, {
      token: access,
      body: { title: t },
    });
    const renamed = await okJson(res, 200, ConversationSchema, "PATCH /conversations/:id");
    expect(renamed.title).toBe(t);
    expect(Date.parse(renamed.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at));
    expect((await listConvs(access)).find((c) => c.id === conv.id)?.title).toBe(t);
    const flows = await okJson(
      await call("GET", `/conversations/${conv.id}/flows`, { token: access }),
      200,
      FlowPage,
      "GET /conversations/:id/flows",
    );
    expect(flows.items.map((f) => f.title)).toEqual([deriveTitle("Câu đầu để có flow")]);
  });

  it("CHAT-AC-22 · E9 → 204; sau đó E7–E12 cùng id 404 NOT_FOUND; E5 không còn id [K-C3]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Sẽ xoá"));
    await expectStatus(
      await call("DELETE", `/conversations/${conv.id}`, { token: access }),
      204,
      "DELETE",
    );
    const p = `/conversations/${conv.id}`;
    const token = access;
    await expectChatError(await call("GET", p, { token }), "NOT_FOUND", "E7 sau xoá");
    await expectChatError(
      await call("PATCH", p, { token, body: { title: "x" } }),
      "NOT_FOUND",
      "E8 sau xoá",
    );
    await expectChatError(await call("DELETE", p, { token }), "NOT_FOUND", "E9 lần 2");
    await expectChatError(await call("GET", `${p}/flows`, { token }), "NOT_FOUND", "E10 sau xoá");
    await expectChatError(
      await call("GET", `${p}/messages`, { token }),
      "NOT_FOUND",
      "E11 sau xoá",
    );
    const e12 = await call("POST", `${p}/messages`, { token, body: { content: "Câu sau xoá" } });
    await expectChatError(e12, "NOT_FOUND", "E12 sau xoá");
    expect((await listConvs(access)).map((c) => c.id)).not.toContain(conv.id);
  });
});

describe("HUB-FR-40 · conversations · danh sách E5", () => {
  it("CHAT-AC-19 · gửi tin vào X → X trước Y; sắp updated_at giảm, hoà → id giảm [K-C4]", async () => {
    const { access } = await lan();
    const x = await newConv(access, title("Hội thoại X"));
    const y = await newConv(access, title("Hội thoại Y"));
    await send(access, x.id, "Cập nhật X");
    const items = await listConvs(access);
    const ix = items.findIndex((c) => c.id === x.id);
    const iy = items.findIndex((c) => c.id === y.id);
    expect(ix).toBeGreaterThanOrEqual(0);
    expect(iy).toBeGreaterThan(ix);
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1] as Conversation;
      const b = items[i] as Conversation;
      const ta = Date.parse(a.updated_at);
      const tb = Date.parse(b.updated_at);
      expect(ta > tb || (ta === tb && a.id > b.id)).toBe(true);
    }
  });

  // T10 (test-plan X1-combine §7.1): user contract trên DB dev tích > 200 hội thoại qua nhiều lượt chạy
  // ⇒ một lần limit=200 chỉ là trang đầu. "Đủ" so với hợp các trang limit=200 đi theo cursor tới null.
  async function walk(token: string, limit: number, max: number): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await okJson(
        await call("GET", `/conversations?${q}`, { token }),
        200,
        ConvPage,
        q,
      );
      expect(page.items.length).toBeLessThanOrEqual(limit);
      ids.push(...page.items.map((c) => c.id));
      cursor = page.next_cursor;
    } while (cursor !== null && ids.length <= max);
    return ids;
  }

  it("CHAT-AC-19 · limit=1 đi theo next_cursor tới null: không lặp, hợp = danh sách limit=200 [K-C5]", async () => {
    const { access } = await lan();
    await newConv(access, title("Trang 1"));
    await newConv(access, title("Trang 2"));
    const first = (await listConvs(access)).map((c) => c.id);
    const all = await walk(access, 200, 100_000);
    expect(new Set(all).size).toBe(all.length);
    expect(all.slice(0, first.length)).toEqual(first);
    const seen = await walk(access, 1, all.length);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(all);
  }, 120_000);

  it("CHAT-AC-19 · cursor rác → 400 VALIDATION_ERROR [K-C5]", async () => {
    const { access } = await lan();
    const res = await call("GET", "/conversations?cursor=rac-khong-hop-le", { token: access });
    await expectChatError(res, "VALIDATION_ERROR", "cursor rác");
  });

  it("CHAT-AC-23 · q không phân biệt hoa thường và dấu; q rỗng = không lọc; q 101 ký tự → 400 [K-C6]", async () => {
    const { access } = await lan();
    const hd = await newConv(access, title("Hoá đơn tháng 9"));
    const kh = await newConv(access, title("Kế hoạch"));
    for (const q of ["hoa don", "HOÁ ĐƠN"]) {
      const ids = (await listConvs(access, `limit=200&q=${encodeURIComponent(q)}`)).map(
        (c) => c.id,
      );
      expect(ids).toContain(hd.id);
      expect(ids).not.toContain(kh.id);
    }
    const all = (await listConvs(access, "limit=200&q=")).map((c) => c.id);
    expect(all).toEqual(expect.arrayContaining([hd.id, kh.id]));
    const long = await call("GET", `/conversations?q=${"a".repeat(101)}`, { token: access });
    await expectChatError(long, "VALIDATION_ERROR", "q 101 ký tự");
  });
});

describe("HUB-FR-40 · conversations · validate và 404 (CHAT-AC-31)", () => {
  it("CHAT-AC-31 · E6 title rỗng / khoảng trắng / 201 ký tự / thừa trường → 400 [K-C7]", async () => {
    const { access } = await lan();
    const bodies = [
      { title: "" },
      { title: "   " },
      { title: "a".repeat(CHAT_TITLE_MAX + 1) },
      { title: "Ok", la: 1 },
    ];
    for (const body of bodies) {
      const res = await call("POST", "/conversations", { token: access, body });
      await expectChatError(res, "VALIDATION_ERROR", `E6 ${JSON.stringify(body).slice(0, 40)}`);
    }
  });

  it("CHAT-AC-31 · E8 thừa trường · E5 limit=0 / 201 → 400 [K-C7]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Validate"));
    const patch = await call("PATCH", `/conversations/${conv.id}`, {
      token: access,
      body: { title: "Ok", la: 1 },
    });
    await expectChatError(patch, "VALIDATION_ERROR", "E8 thừa trường");
    for (const limit of ["0", "201"]) {
      const res = await call("GET", `/conversations?limit=${limit}`, { token: access });
      await expectChatError(res, "VALIDATION_ERROR", `E5 limit=${limit}`);
    }
  });

  it("CHAT-AC-31 · E7 id không phải uuid / uuid lạ → 404 NOT_FOUND (không 400) [K-C8]", async () => {
    const { access } = await lan();
    await expectChatError(
      await call("GET", "/conversations/abc", { token: access }),
      "NOT_FOUND",
      "E7 abc",
    );
    const res = await call("GET", `/conversations/${UNKNOWN_UUID}`, { token: access });
    await expectChatError(res, "NOT_FOUND", "E7 uuid lạ");
  });
});

const HOUR = 3_600_000;
const SEED = [
  { title: "Soạn email báo giá Minh Phát", agoMs: 2 * 60_000 },
  { title: "Hoá đơn tháng 9 cần đối chiếu", agoMs: 3 * 24 * HOUR },
  { title: "Tóm tắt họp giao ban", agoMs: 20 * 24 * HOUR },
  { title: "Kế hoạch marketing Q3", agoMs: 60 * 24 * HOUR },
] as const;

describe.if(isMock)("conversations · seed minh (chỉ mock)", () => {
  it("CHAT-AC-19 · minh có 4 hội thoại seed với updated_at ≈ now−2 phút/−3 ngày/−20 ngày/−60 ngày [K-C9]", async () => {
    const { access } = await minh();
    const items = await listConvs(access);
    const now = Date.now();
    for (const s of SEED) {
      const c = items.find((i) => i.title === s.title);
      expect(c?.title).toBe(s.title);
      expect(Math.abs(Date.parse(c?.updated_at ?? "") - (now - s.agoMs))).toBeLessThanOrEqual(HOUR);
    }
    expect(items.map((i) => i.title)).toEqual(SEED.map((s) => s.title));
  });

  it("CHAT-AC-09 · CHAT-AC-20 · flow seed 'Soạn email…': 2 flow tăng dần; F1 có 2 bước, 7800 ms; F2 4 tin [K-C10]", async () => {
    const { access } = await minh();
    const conv = (await listConvs(access)).find((c) => c.title === SEED[0].title);
    expect(conv?.title).toBe(SEED[0].title);
    const res = await call("GET", `/conversations/${conv?.id}/flows`, { token: access });
    const flows = (await okJson(res, 200, FlowPage, "E10 seed")).items;
    expect(flows.length).toBe(2);
    const [f1, f2] = flows;
    expect(Date.parse(f1?.created_at ?? "")).toBeLessThan(Date.parse(f2?.created_at ?? ""));
    expect(f1?.preview.answer?.run?.steps.length).toBe(2);
    expect(f1?.preview.answer?.run?.ms).toBe(7800);
    expect(f2?.message_count).toBe(4);
    const msgs = await call("GET", `/conversations/${conv?.id}/messages?flow_id=${f2?.id}`, {
      token: access,
    });
    expect((await okJson(msgs, 200, MessagePage, "E11 seed F2")).items.length).toBe(4);
  });
});
