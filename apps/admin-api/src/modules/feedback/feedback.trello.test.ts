// feedback · unit adapter Trello: dựng thẻ (name/desc), bỏ qua khi thiếu env, lỗi không ném, không lộ key/token.
import { describe, expect, it } from "bun:test";
import type { FeedbackItem } from "@ai/contracts";
import {
  cardDesc,
  cardName,
  pushFeedbackToTrello,
  safePage,
  trelloFromEnv,
} from "./feedback.trello";

const item: FeedbackItem = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "22222222-2222-4222-8222-222222222222",
  tenant_name: "Công ty A",
  user_id: "33333333-3333-4333-8333-333333333333",
  user_name: "Nguyễn Văn B",
  app: "contracts",
  kind: "bug",
  message: "Nút lưu\nkhông hoạt động",
  page_url: "https://x.test/p",
  app_version: "1.2.3",
  status: "new",
  reply: null,
  replied_at: null,
  created_at: "2026-10-27T00:00:00.000Z",
  files: [],
};
const cfg = { apiKey: "KEY-SECRET", token: "TOK-SECRET", listId: "list1" };
const file = { name: "a.png", mime: "image/png", bytes: Buffer.from([1, 2, 3]) };

describe("trello · dựng thẻ", () => {
  it("name = [Loại] đầu nội dung một dòng, ≤ 120 ký tự", () => {
    expect(cardName(item)).toBe("[Lỗi] Nút lưu không hoạt động");
    const long = cardName({ kind: "idea", message: "x".repeat(500) });
    expect(long.length).toBe(120);
    expect(long.startsWith("[Ý tưởng] x")).toBe(true);
  });
  it("desc có nội dung, công ty, người gửi, app/trang/phiên bản", () => {
    const d = cardDesc(item);
    for (const s of [
      "Nút lưu",
      "Công ty A",
      "Nguyễn Văn B",
      "contracts",
      "https://x.test/p",
      "1.2.3",
    ])
      expect(d).toContain(s);
  });
  it("trelloFromEnv: thiếu một biến ⇒ undefined", () => {
    expect(trelloFromEnv({ TRELLO_API_KEY: "a", TRELLO_TOKEN: "b" })).toBeUndefined();
    expect(
      trelloFromEnv({ TRELLO_API_KEY: "a", TRELLO_TOKEN: "b", TRELLO_FEEDBACK_LIST_ID: "c" }),
    ).toEqual({ apiKey: "a", token: "b", listId: "c" });
  });
});

describe("trello · adapter", () => {
  it("không cấu hình ⇒ không gọi mạng", async () => {
    let calls = 0;
    const r = await pushFeedbackToTrello(undefined, item, [], async () => {
      calls++;
      return new Response("{}");
    });
    expect(r).toBeNull();
    expect(calls).toBe(0);
  });

  it("tạo thẻ rồi đính kèm từng tệp; key/token không nằm trong URL", async () => {
    const urls: string[] = [];
    const r = await pushFeedbackToTrello(cfg, item, [file, file], async (url, init) => {
      urls.push(url);
      expect(init.method).toBe("POST");
      return new Response(JSON.stringify({ id: "card9", shortUrl: "https://trello.com/c/abc" }));
    });
    expect(r).toBe("https://trello.com/c/abc");
    expect(urls).toEqual([
      "https://api.trello.com/1/cards",
      "https://api.trello.com/1/cards/card9/attachments",
      "https://api.trello.com/1/cards/card9/attachments",
    ]);
    expect(urls.join()).not.toContain("SECRET");
  });

  it("Trello lỗi (HTTP hoặc mạng) ⇒ không ném, trả null", async () => {
    expect(
      await pushFeedbackToTrello(cfg, item, [file], async () => new Response("x", { status: 401 })),
    ).toBeNull();
    expect(
      await pushFeedbackToTrello(cfg, item, [], async () => {
        throw new Error("boom https://api.trello.com/1/cards?key=KEY-SECRET");
      }),
    ).toBeNull();
  });

  it("đính kèm lỗi ⇒ vẫn trả URL thẻ", async () => {
    let n = 0;
    const r = await pushFeedbackToTrello(cfg, item, [file], async () =>
      n++ === 0
        ? new Response(JSON.stringify({ id: "c", shortUrl: "https://t/c" }))
        : new Response("", { status: 500 }),
    );
    expect(r).toBe("https://t/c");
  });
});

describe("trello · sửa review", () => {
  it("thiếu id thẻ ⇒ không gọi attachments", async () => {
    const urls: string[] = [];
    await pushFeedbackToTrello(cfg, item, [file], async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ shortUrl: "https://t/c" }));
    });
    expect(urls).toEqual(["https://api.trello.com/1/cards"]);
    expect(urls.join()).not.toContain("undefined");
  });

  it("page_url chỉ giữ origin + path", () => {
    expect(safePage("https://x.test/a/b?token=SECRET&x=1#frag")).toBe("https://x.test/a/b");
    expect(safePage("/a/b?t=1#h")).toBe("/a/b");
    expect(cardDesc({ ...item, page_url: "https://x.test/p?k=SECRET" })).not.toContain("SECRET");
  });

  it("tối đa 2 lời gọi đồng thời; hàng đợi > 50 bị bỏ qua", async () => {
    let cur = 0;
    let max = 0;
    const gates: Array<() => void> = [];
    const fetchFn = async () => {
      cur++;
      max = Math.max(max, cur);
      await new Promise<void>((r) => gates.push(r));
      cur--;
      return new Response(JSON.stringify({ id: "c", shortUrl: "https://t/c" }));
    };
    const runs = Array.from({ length: 60 }, () => pushFeedbackToTrello(cfg, item, [], fetchFn));
    await Promise.resolve();
    await Promise.resolve();
    expect(max).toBe(2);
    // 2 đang chạy + 50 xếp hàng; 8 cuối bị bỏ qua ngay (null). Mở cổng dần tới khi xong hết.
    let done = false;
    const all = Promise.all(runs).then((r) => {
      done = true;
      return r;
    });
    while (!done) {
      for (const g of gates.splice(0)) g();
      await new Promise<void>((r) => queueMicrotask(r));
    }
    const res = await all;
    expect(res.filter((r) => r === null).length).toBe(8);
    expect(max).toBe(2);
  });
});
