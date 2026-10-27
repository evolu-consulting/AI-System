// trello-config-ui · unit (viết trước code): thứ tự DB ⇒ env, view không lộ secret, mã hoá tách miền theo trường,
// "Kiểm tra kết nối" chỉ GET list (không tạo thẻ, key/token không nằm trong URL).
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { parseMasterKey } from "../../lib/secret-crypto";
import { checkTrelloList } from "./feedback.trello";
import {
  openTrelloField,
  pickTrello,
  sealTrelloField,
  type TrelloRowMeta,
  trelloView,
} from "./trello-config.rules";

const DB = { apiKey: "DB-KEY-SECRET-1234", token: "DB-TOK-SECRET-5678", listId: "dbList" };
const ENV = { apiKey: "ENV-KEY-SECRET", token: "ENV-TOK-SECRET", listId: "envList" };
const key = parseMasterKey(randomBytes(32).toString("base64"));
const meta: TrelloRowMeta = {
  apiKeyLast4: "1234",
  tokenLast4: "5678",
  listId: "dbList",
  updatedAt: new Date("2026-10-27T00:00:00.000Z"),
};

describe("trello-config · thứ tự DB ⇒ env", () => {
  it("có DB ⇒ dùng DB (kể cả khi env đủ)", () => {
    expect(pickTrello(DB, ENV)).toEqual(DB);
    expect(pickTrello(DB, undefined)).toEqual(DB);
  });
  it("không có DB ⇒ env như cũ; không có cả hai ⇒ undefined", () => {
    expect(pickTrello(undefined, ENV)).toEqual(ENV);
    expect(pickTrello(undefined, undefined)).toBeUndefined();
  });
});

describe("trello-config · view che secret", () => {
  it("hàng DB ⇒ source db, set + 4 ký tự cuối, không có giá trị", () => {
    const v = trelloView(meta, ENV);
    expect(v).toEqual({
      source: "db",
      env_configured: true,
      api_key: { set: true, last4: "1234" },
      token: { set: true, last4: "5678" },
      list_id: "dbList",
      updated_at: "2026-10-27T00:00:00.000Z",
    });
    expect(JSON.stringify(v)).not.toContain("SECRET");
  });
  it("không hàng ⇒ source env/none, không lộ gì của env", () => {
    const e = trelloView(null, ENV);
    expect(e).toMatchObject({
      source: "env",
      env_configured: true,
      api_key: { set: false, last4: null },
      token: { set: false, last4: null },
      list_id: null,
    });
    expect(JSON.stringify(e)).not.toContain("SECRET");
    expect(JSON.stringify(e)).not.toContain("envList");
    expect(trelloView(null, undefined).source).toBe("none");
  });
});

describe("trello-config · mã hoá theo trường", () => {
  it("giải mã đúng trường; đổi trường (AAD) hoặc khoá ⇒ ném", () => {
    const s = sealTrelloField(key, "api_key", DB.apiKey);
    expect(Buffer.from(s.ciphertext).toString("utf8")).not.toContain("SECRET");
    expect(openTrelloField(key, "api_key", s)).toBe(DB.apiKey);
    expect(() => openTrelloField(key, "token", s)).toThrow();
    const other = parseMasterKey(randomBytes(32).toString("base64"));
    expect(() => openTrelloField(other, "api_key", s)).toThrow();
  });
  it("IV mới mỗi lần ghi", () => {
    const a = sealTrelloField(key, "token", "same");
    const b = sealTrelloField(key, "token", "same");
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
  });
});

describe("trello-config · kiểm tra kết nối (fake fetch)", () => {
  it("GET /lists/:id, key/token chỉ ở header ⇒ ok + tên list", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const r = await checkTrelloList(DB, async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ id: "dbList", name: "Mới" }));
    });
    expect(r).toEqual({ ok: true, list_name: "Mới", error: null });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.init.method).toBe("GET");
    expect(seen[0]?.url).toBe("https://api.trello.com/1/lists/dbList?fields=name");
    expect(seen[0]?.url).not.toContain("SECRET");
  });
  it("401 ⇒ unauthorized; 404 ⇒ not_found; 500 ⇒ http; lỗi mạng ⇒ network", async () => {
    const st = (s: number) => async () => new Response("x", { status: s });
    expect((await checkTrelloList(DB, st(401))).error).toBe("unauthorized");
    expect((await checkTrelloList(DB, st(404))).error).toBe("not_found");
    expect((await checkTrelloList(DB, st(500))).error).toBe("http");
    const net = await checkTrelloList(DB, async () => {
      throw new Error("boom ?key=DB-KEY-SECRET-1234");
    });
    expect(net).toEqual({ ok: false, list_name: null, error: "network" });
  });
});
