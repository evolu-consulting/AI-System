// C5 · adapter mock tuân hien-thi.md: phạm vi thấy, che liên hệ, không lộ cờ Lưu báo giá cho đối tác.
import { describe, expect, test } from "bun:test";
import { CommentPageSchema, CommentViewSchema, FeedResponseSchema } from "@ai/contracts/community";
import { createMockApi } from "./mock";

const as = (id: string) => {
  const m = createMockApi();
  m.setPersona(id);
  return m.api;
};
const feed = async (id: string, tab: "all" | "archived" = "all") =>
  (await as(id).listFeed({ tab })).items;

describe("mock · hiển thị", () => {
  test("chủ quản thấy cả bài đối tác (kèm raw + hits) và bài ẩn", async () => {
    const items = await feed("an");
    const tp = items.find((p) => p.id === "p5");
    expect(tp?.body).toContain("0903 123 456");
    expect(tp?.hits?.length).toBeGreaterThan(0);
    expect(items.find((p) => p.id === "p9")?.hidden).toBe(true);
  });
  test("S1 (NCC): thấy bài chủ quản 'tất cả' + bài mình; không thấy 'chỉ người mua', bài ẩn của S2, bài đối tác khác", async () => {
    const ids = (await feed("tp")).map((p) => p.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p5");
    expect(ids).not.toContain("p4"); // audience buyers
    expect(ids).not.toContain("p6"); // bài của ABC
    expect(ids).not.toContain("p9");
  });
  test("bài của chính S1 đã che với người khác nhưng S1 đọc lại cũng chỉ masked (HT-52)", async () => {
    const own = (await feed("tp")).find((p) => p.id === "p5");
    expect(own?.body).not.toMatch(/0903|fb\.com|NCCA/);
    expect(own?.hits).toBeUndefined();
    expect(own?.hidden).toBeUndefined();
  });
  test("lưu trữ ẩn khỏi người khác, ở tab Đã lưu trữ của chủ bài (HT-15/31)", async () => {
    expect((await feed("ncca")).map((p) => p.id)).not.toContain("p8");
    expect((await feed("an", "archived")).map((p) => p.id)).toContain("p8");
    expect((await feed("tp", "archived")).map((p) => p.id)).toEqual(["p8"]);
  });
  test("audience theo nhóm hàng: ABC thấy p4? không (buyers+ABC buyer ⇒ có); NCCA không thấy p4", async () => {
    expect((await feed("abc")).map((p) => p.id)).toContain("p4");
    expect((await feed("ncca")).map((p) => p.id)).not.toContain("p4");
  });
});

describe("mock · hành động, luồng, lộ dấu hiệu", () => {
  test("không bao giờ có saveQuote / hide cho đối tác (HT-64, 65)", async () => {
    for (const id of ["tp", "ncca", "abc", "ht"]) {
      for (const p of await feed(id)) {
        expect(p.actions).not.toContain("saveQuote");
        expect(p.actions).not.toContain("hide");
        expect(Object.keys(p)).not.toContain("savedQuote");
      }
    }
    const an = (await feed("an")).find((p) => p.id === "p5");
    expect(an?.actions).toContain("saveQuote");
    expect(an?.actions).toContain("hide");
  });
  test("bình luận phẳng: ABC không thấy bình luận công ty khác; chủ quản thấy hết (HT-42)", async () => {
    const abc = await as("abc").listComments("p1");
    expect(abc.comments.every((c) => c.authorOrgId === "abc" || c.authorOrgId === "host")).toBe(
      true,
    );
    expect(JSON.stringify(abc)).not.toContain("HSM");
    const host = await as("an").listComments("p1");
    expect(host.comments.map((c) => c.authorOrgId)).toContain("hungthinh");
  });
  test("nhắc @: chủ quản có gợi ý, đối tác rỗng; ngoài tập ⇒ 422; đối tác chỉ thấy nhắc tới mình", async () => {
    expect((await as("an").listMentionables("p1", "abc")).map((m) => m.orgId)).toEqual(["abc"]);
    expect(await as("abc").listMentionables("p1")).toEqual([]);
    const m = createMockApi();
    m.setPersona("an");
    const an = m.api;
    await expect(an.addComment("p1", { text: "x", mentions: ["host"] })).rejects.toMatchObject({
      code: "MENTION_NOT_ALLOWED",
    });
    const c = await an.addComment("p1", { text: "@Công ty TNHH ABC ok", mentions: ["abc"] });
    expect(c.mentions.map((m) => m.orgId)).toEqual(["abc"]);
    m.setPersona("abc");
    const seen = (await m.api.listComments("p1")).comments.find((x) => x.id === c.id);
    expect(seen?.mentions).toEqual([{ orgId: "abc", name: "Công ty TNHH ABC" }]);
  });
  test("vòng đời bài: tạo → sửa (đã sửa) → lưu trữ → bỏ lưu trữ → xoá", async () => {
    const api = as("tp");
    const p = await api.createPost({
      type: "sell",
      title: "Keo",
      body: "",
      cats: [],
      media: [],
      fields: { product: "Keo", qty: "5", price: null, area: "" },
    });
    expect(p.edited).toBe(false);
    expect((await api.updatePost(p.id, { body: "mới" })).edited).toBe(true);
    expect((await api.postAction(p.id, { action: "archive" }))?.status).toBe("archived");
    expect((await api.postAction(p.id, { action: "unarchive" }))?.status).toBe("active");
    expect(await api.postAction(p.id, { action: "delete" })).toBeNull();
    expect((await api.listFeed({ tab: "all", mine: true })).items.map((x) => x.id)).not.toContain(
      p.id,
    );
  });
  test("đối tác không chọn người xem, không đăng Thông báo; bài mới báo chủ quản", async () => {
    const m = createMockApi();
    m.setPersona("abc");
    await expect(
      m.api.createPost({
        type: "buy",
        title: "",
        body: "",
        cats: [],
        media: [],
        audience: { mode: "all", cats: [], companies: [] },
        fields: { product: "A", qty: "1", area: "HCM", neededBy: "2026-12-01", budget: "" },
      }),
    ).rejects.toThrow("422");
    await m.api.createPost({
      type: "buy",
      title: "A",
      body: "",
      cats: [],
      media: [],
      fields: { product: "A", qty: "1", area: "HCM", neededBy: "2026-12-01", budget: "" },
    });
  });
});

describe("mock · khớp contract zod (strict)", () => {
  test("feed + luồng của mọi persona parse được", async () => {
    for (const id of ["an", "cuong", "tp", "ncca", "abc", "ht"]) {
      const api = as(id);
      const feed = await api.listFeed({ tab: "all" });
      expect(() => FeedResponseSchema.parse(feed)).not.toThrow();
      const archived = await api.listFeed({ tab: "archived" });
      expect(() => FeedResponseSchema.parse(archived)).not.toThrow();
      const page = CommentPageSchema.parse(await api.listComments("p1"));
      for (const c of page.comments) expect(() => CommentViewSchema.parse(c)).not.toThrow();
    }
  });
});
