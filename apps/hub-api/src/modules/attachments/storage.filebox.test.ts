// HUB-FR-44 · CR-filebox · driver `filebox`: nội dung ở FileBox (API v1), ánh xạ khoá → file_id ở `BlobIndex`.
// FileBox giả = Bun.serve cục bộ (đúng đường dẫn/khoá của API v1); index = bản trong bộ nhớ (bản SQL: storage.filebox.index.ts).
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type AttachmentStorage,
  StorageKeyError,
  StorageRejected,
  StorageTooLarge,
} from "./storage";
import {
  type BlobIndex,
  type BlobRow,
  createFileboxStorage,
  fileboxClient,
} from "./storage.filebox";

const TOKEN = "tok_0123456789abcdef0123456789";
const T = "11111111-1111-4111-8111-111111111111";
const KEY = `${T}/22222222-2222-4222-8222-222222222222`;
const KEY2 = `${T}/33333333-3333-4333-8333-333333333333`;

type Stored = { org: string; name: string; bytes: Uint8Array };
const files = new Map<string, Stored>();
const calls: string[] = [];
let failUpload = 0;
let seq = 0;

async function uploadFile(req: Request, u: URL): Promise<Response> {
  if (failUpload > 0) {
    failUpload--;
    return Response.json({ detail: "boom" }, { status: 500 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  const id = (++seq).toString(16).padStart(16, "0");
  const org = u.searchParams.get("org") ?? "";
  files.set(id, { org, name: u.searchParams.get("name") ?? "", bytes });
  return Response.json({ file_id: id, size: bytes.length, state: "ready" });
}

function fileOp(req: Request, u: URL): Response {
  const m = u.pathname.match(/^\/files\/([0-9a-f]{16})(\/content)?$/);
  const id = m?.[1] ?? "";
  const f = files.get(id);
  if (!m || !f) return Response.json({ detail: "not found" }, { status: 404 });
  if (req.method === "GET" && m[2]) return new Response(f.bytes);
  if (req.method !== "DELETE" || m[2]) return Response.json({ detail: "?" }, { status: 405 });
  files.delete(id);
  return Response.json({ deleted: id });
}

const fake = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    calls.push(`${req.method} ${u.pathname}${u.search}`);
    if (req.headers.get("authorization") !== `Bearer ${TOKEN}`)
      return Response.json({ detail: "bad key" }, { status: 401 });
    if (u.pathname === "/files")
      return req.method === "POST" ? uploadFile(req, u) : Response.json([]);
    return fileOp(req, u);
  },
});
afterAll(() => fake.stop(true));

/** Index trong bộ nhớ, cùng hợp đồng với bản SQL. */
function memoryIndex(): BlobIndex & { rows: Map<string, BlobRow> } {
  const rows = new Map<string, BlobRow>();
  return {
    rows,
    async reserve(key) {
      if (rows.has(key)) return false;
      rows.set(key, { key, fileId: null, partial: true, size: 0, createdMs: Date.now() });
      return true;
    },
    async attach(key, fileId, size) {
      const r = rows.get(key);
      if (r) rows.set(key, { ...r, fileId, size });
    },
    async commit(key) {
      const r = rows.get(key);
      if (r) rows.set(key, { ...r, partial: false });
    },
    async get(key) {
      return rows.get(key) ?? null;
    },
    async drop(key) {
      rows.delete(key);
    },
    async list(after, limit) {
      return [...rows.values()]
        .sort((a, b) => (a.key < b.key ? -1 : 1))
        .filter(
          (r) =>
            !after || r.key > after.key || (r.key === after.key && r.partial && !after.partial),
        )
        .slice(0, limit);
    },
  };
}

const body = (s: string | Uint8Array) => new Blob([s]).stream();
const url = () => `http://127.0.0.1:${fake.port}`;
let index: ReturnType<typeof memoryIndex>;
let store: AttachmentStorage;

beforeEach(async () => {
  files.clear();
  calls.length = 0;
  failUpload = 0;
  index = memoryIndex();
  store = await createFileboxStorage({
    client: fileboxClient({ url: url(), token: TOKEN, org: "ai-system" }),
    index,
  });
});

describe("HUB-FR-44 · driver filebox", () => {
  it("stage → chưa đọc được; commit → open/blob trả đúng nội dung; size + sha256", async () => {
    const s = await store.stage(KEY, body("xin chào"), { maxBytes: 100 });
    expect(s.size).toBe(Buffer.byteLength("xin chào"));
    expect(s.sha256).toBe(new Bun.CryptoHasher("sha256").update("xin chào").digest("hex"));
    expect(await store.open(KEY)).toBeNull();
    await s.commit();
    const o = await store.open(KEY);
    expect(o?.size).toBe(s.size);
    expect(await new Response(o?.stream).text()).toBe("xin chào");
    const b = await store.blob(KEY, "text/plain");
    expect(b?.type).toStartWith("text/plain");
    expect(await b?.text()).toBe("xin chào");
    const up = [...files.values()][0];
    expect(up?.org).toBe("ai-system");
    expect(up?.name).toBe(KEY.replace("/", "_"));
  });

  it("khoá FileBox chỉ ở header, không bao giờ ở URL", async () => {
    await (await store.stage(KEY, body("a"), { maxBytes: 10 })).commit();
    await store.open(KEY);
    await store.remove(KEY);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).not.toContain(TOKEN);
  });

  it("vượt maxBytes / inspect từ chối → lỗi, không tải lên, không để lại hàng index", async () => {
    await expect(store.stage(KEY, body("123456"), { maxBytes: 5 })).rejects.toBeInstanceOf(
      StorageTooLarge,
    );
    const no = { push: () => false, end: () => true };
    await expect(
      store.stage(KEY, body("abc"), { maxBytes: 10, inspect: no }),
    ).rejects.toBeInstanceOf(StorageRejected);
    const late = { push: () => true, end: () => false };
    await expect(
      store.stage(KEY, body("abc"), { maxBytes: 10, inspect: late }),
    ).rejects.toBeInstanceOf(StorageRejected);
    expect(files.size).toBe(0);
    expect(index.rows.size).toBe(0);
  });

  it("tải lên lỗi → ném, xoá hàng index; khoá sai → StorageKeyError", async () => {
    failUpload = 1;
    await expect(store.stage(KEY, body("a"), { maxBytes: 10 })).rejects.toThrow();
    expect(index.rows.size).toBe(0);
    await expect(store.stage("not/a-key", body("a"), { maxBytes: 10 })).rejects.toBeInstanceOf(
      StorageKeyError,
    );
  });

  it("stage trùng khoá đang có → lỗi, không ghi đè", async () => {
    await (await store.stage(KEY, body("one"), { maxBytes: 10 })).commit();
    await expect(store.stage(KEY, body("two"), { maxBytes: 10 })).rejects.toThrow();
    expect(await (await store.blob(KEY, "text/plain"))?.text()).toBe("one");
  });

  it("discard / remove xoá cả FileBox lẫn index; remove khoá không có = ok", async () => {
    const s = await store.stage(KEY, body("a"), { maxBytes: 10 });
    await s.discard();
    expect(files.size).toBe(0);
    expect(index.rows.size).toBe(0);
    await (await store.stage(KEY, body("b"), { maxBytes: 10 })).commit();
    await store.remove(KEY);
    expect(files.size).toBe(0);
    expect(await store.open(KEY)).toBeNull();
    await store.remove(KEY2);
  });

  it("file đã mất ở FileBox → open/blob trả null", async () => {
    await (await store.stage(KEY, body("a"), { maxBytes: 10 })).commit();
    files.clear();
    expect(await store.open(KEY)).toBeNull();
    expect(await store.blob(KEY, "text/plain")).toBeNull();
  });

  it("promote: partial có file → đọc được; partial chưa có file → bỏ hàng; không có = ok", async () => {
    await store.stage(KEY, body("a"), { maxBytes: 10 });
    await store.promote(KEY);
    expect(await (await store.blob(KEY, "text/plain"))?.text()).toBe("a");
    await index.reserve(KEY2);
    await store.promote(KEY2);
    expect(index.rows.has(KEY2)).toBe(false);
    await store.promote(KEY2);
  });

  it("list: theo khoá, partial đúng, con trỏ chuỗi và cặp", async () => {
    await (await store.stage(KEY, body("aa"), { maxBytes: 10 })).commit();
    await store.stage(KEY2, body("b"), { maxBytes: 10 });
    const all = await store.list({ after: null, limit: 10 });
    expect(all.map((e) => [e.key, e.partial, e.size])).toEqual([
      [KEY, false, 2],
      [KEY2, true, 1],
    ]);
    expect(all[0]?.mtimeMs).toBeGreaterThan(0);
    expect((await store.list({ after: KEY, limit: 10 })).map((e) => e.key)).toEqual([KEY2]);
    expect(await store.list({ after: { key: KEY2, partial: true }, limit: 10 })).toEqual([]);
    expect((await store.list({ after: null, limit: 1 })).length).toBe(1);
  });

  it("khởi tạo: khoá sai → lỗi không chứa khoá; driver = filebox", async () => {
    expect(store.driver).toBe("filebox");
    const bad = createFileboxStorage({
      client: fileboxClient({ url: url(), token: "tok_wrong_wrong_wrong_wrong", org: "ai-system" }),
      index: memoryIndex(),
    });
    await expect(bad).rejects.toThrow(/401/);
    await bad.catch((e: Error) => expect(e.message).not.toContain("tok_wrong"));
  });
});
