// HUB-FR-44 · H2c-R04, R05 · PL1, P23 · driver `local` trên thư mục tạm: gốc tạo/ghi thử, lỗi không lộ đường dẫn, hai pha
// stage → commit/discard, bộ đếm byte, inspect, `.part` không ghi đè, open/blob/remove/list, body không bị huỷ khi lỗi.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageKeyError, StorageRejected, StorageTooLarge } from "./storage";
import { createLocalStorage } from "./storage.local";

const WIN = process.platform === "win32";
const dirs: string[] = [];
const temp = async () => {
  const d = await mkdtemp(join(tmpdir(), "hub-att-unit-"));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const T = "0b3e6f4c-1d2a-4c5b-8e9f-000000000001";
const id = (n: number) => `0b3e6f4c-1d2a-4c5b-8e9f-${String(n).padStart(12, "0")}`;
const enc = (s: string) => new TextEncoder().encode(s);
const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(x);
      c.close();
    },
  });
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe("createLocalStorage [H2c-R04 · L8]", () => {
  test("dir chưa có → tạo (0700 khi không win32), không để lại file thử", async () => {
    const dir = join(await temp(), "a", "b");
    await createLocalStorage({ dir });
    const st = await stat(dir);
    expect(st.isDirectory()).toBe(true);
    if (!WIN) expect(st.mode & 0o777).toBe(0o700);
    expect(await readdir(dir)).toEqual([]);
  });

  test("dir tương đối / là file thường → ném, message không chứa đường dẫn", async () => {
    const parent = await temp();
    const f = join(parent, "marker-file");
    await writeFile(f, "x");
    for (const dir of ["rel/marker-file", f]) {
      const e = await err(createLocalStorage({ dir }));
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).not.toContain("marker-file");
    }
  });
});

describe("stage / commit / discard [H2c-R05 · PL1]", () => {
  test("stage nhiều chunk → size/sha256; .part rồi commit thành file 0600", async () => {
    const dir = await temp();
    const s = await createLocalStorage({ dir });
    const staged = await s.stage(`${T}/${id(1)}`, streamOf(enc("ab"), enc("c")), { maxBytes: 3 });
    expect(staged.size).toBe(3);
    expect(staged.sha256).toBe(new Bun.CryptoHasher("sha256").update("abc").digest("hex"));
    expect(await readdir(join(dir, T))).toEqual([`${id(1)}.part`]);
    await staged.commit();
    expect(await readFile(join(dir, T, id(1)), "utf8")).toBe("abc");
    if (!WIN) expect((await stat(join(dir, T, id(1)))).mode & 0o777).toBe(0o600);
    const d = await s.stage(`${T}/${id(2)}`, streamOf(enc("x")), { maxBytes: 3 });
    await d.discard();
    expect(await readdir(join(dir, T))).toEqual([id(1)]);
  });

  test("vượt maxBytes / inspect false (push hoặc end) → lỗi riêng, không .part; body không bị huỷ (đọc tiếp được)", async () => {
    const dir = await temp();
    const s = await createLocalStorage({ dir });
    const body = streamOf(enc("12"), enc("34"), enc("56"));
    expect(await err(s.stage(`${T}/${id(3)}`, body, { maxBytes: 3 }))).toBeInstanceOf(
      StorageTooLarge,
    );
    const reader = body.getReader();
    const next = await reader.read();
    expect(new TextDecoder().decode(next.value)).toBe("56");
    const no = { push: () => false, end: () => true };
    const noEnd = { push: () => true, end: () => false };
    for (const inspect of [no, noEnd])
      expect(
        await err(s.stage(`${T}/${id(4)}`, streamOf(enc("a")), { maxBytes: 9, inspect })),
      ).toBeInstanceOf(StorageRejected);
    expect(await readdir(join(dir, T))).toEqual([]);
  });

  test("khoá sai → StorageKeyError; .part có sẵn → lỗi, giữ nội dung cũ", async () => {
    const dir = await temp();
    const s = await createLocalStorage({ dir });
    for (const k of ["../x", `${T}/../${id(1)}`, `${T}/${id(1)}`.toUpperCase(), `${T}\\${id(1)}`])
      expect(await err(s.stage(k, streamOf(enc("x")), { maxBytes: 9 }))).toBeInstanceOf(
        StorageKeyError,
      );
    await s.stage(`${T}/${id(5)}`, streamOf(enc("old")), { maxBytes: 9 });
    expect(
      await err(s.stage(`${T}/${id(5)}`, streamOf(enc("new")), { maxBytes: 9 })),
    ).not.toBeNull();
    expect(await readFile(join(dir, T, `${id(5)}.part`), "utf8")).toBe("old");
  });
});

describe("open / blob / remove / list [PL1]", () => {
  test("open/blob chỉ file đã commit; remove xoá cả .part; list sắp theo key, phân trang, bỏ tên lạ", async () => {
    const dir = await temp();
    const s = await createLocalStorage({ dir });
    const a = await s.stage(`${T}/${id(1)}`, streamOf(enc("hello")), { maxBytes: 9 });
    await a.commit();
    await s.stage(`${T}/${id(2)}`, streamOf(enc("part")), { maxBytes: 9 });
    await writeFile(join(dir, T, "la.txt"), "x");
    const o = await s.open(`${T}/${id(1)}`);
    expect(o?.size).toBe(5);
    expect(await new Response(o?.stream).text()).toBe("hello");
    expect(await s.open(`${T}/${id(2)}`)).toBeNull();
    expect(await s.open(`${id(9)}/${id(1)}`)).toBeNull();
    const b = await s.blob(`${T}/${id(1)}`, "application/pdf");
    expect({ size: b?.size, type: b?.type }).toEqual({ size: 5, type: "application/pdf" });
    const p1 = await s.list({ after: null, limit: 1 });
    expect(p1.map((e) => [e.key, e.partial, e.size])).toEqual([[`${T}/${id(1)}`, false, 5]]);
    const p2 = await s.list({ after: p1[0]?.key ?? null, limit: 5 });
    expect(p2.map((e) => [e.key, e.partial])).toEqual([[`${T}/${id(2)}`, true]]);
    await s.remove(`${T}/${id(2)}`);
    await s.remove(`${id(9)}/${id(9)}`);
    expect((await s.list({ after: null, limit: 5 })).map((e) => e.key)).toEqual([`${T}/${id(1)}`]);
  });
});

describe("promote [PL13]", () => {
  test(".part → file; file đã có ⇒ chỉ xoá .part; không có gì ⇒ ok", async () => {
    const dir = await temp();
    const s = await createLocalStorage({ dir });
    const k1 = `${T}/${id(1)}`;
    await s.stage(k1, streamOf(enc("crash")), { maxBytes: 9 });
    await s.promote(k1);
    expect(await new Response((await s.open(k1))?.stream).text()).toBe("crash");
    const k2 = `${T}/${id(2)}`;
    await (await s.stage(k2, streamOf(enc("done")), { maxBytes: 9 })).commit();
    await writeFile(join(dir, T, `${id(2)}.part`), "stale");
    await s.promote(k2);
    expect((await s.list({ after: null, limit: 9 })).map((e) => [e.key, e.partial])).toEqual([
      [k1, false],
      [k2, false],
    ]);
    expect(await new Response((await s.open(k2))?.stream).text()).toBe("done");
    await s.promote(`${T}/${id(3)}`);
    await s.promote(`${id(9)}/${id(9)}`);
  });
});

describe("list con trỏ (key, partial) [RV-9]", () => {
  test("<key> và <key>.part cùng có: trang 1 dừng ở file ⇒ trang 2 (cặp) vẫn có .part; chuỗi = bỏ cả khoá", async () => {
    const dir = await temp();
    const s = await createLocalStorage({ dir });
    const k = `${T}/${id(1)}`;
    await (await s.stage(k, streamOf(enc("done")), { maxBytes: 9 })).commit();
    await writeFile(join(dir, T, `${id(1)}.part`), "stale");
    await (await s.stage(`${T}/${id(2)}`, streamOf(enc("b")), { maxBytes: 9 })).commit();
    const p1 = await s.list({ after: null, limit: 1 });
    expect(p1.map((e) => [e.key, e.partial])).toEqual([[k, false]]);
    const p2 = await s.list({ after: { key: k, partial: false }, limit: 5 });
    expect(p2.map((e) => [e.key, e.partial])).toEqual([
      [k, true],
      [`${T}/${id(2)}`, false],
    ]);
    const p3 = await s.list({ after: { key: k, partial: true }, limit: 5 });
    expect(p3.map((e) => e.key)).toEqual([`${T}/${id(2)}`]);
    expect((await s.list({ after: k, limit: 5 })).map((e) => e.key)).toEqual([`${T}/${id(2)}`]);
  });
});

/** Windows không quyền tạo symlink (EPERM) ⇒ bỏ ca. */
async function canSymlink(): Promise<boolean> {
  const d = await mkdtemp(join(tmpdir(), "hub-att-ln-"));
  try {
    await writeFile(join(d, "t"), "x");
    await symlink(join(d, "t"), join(d, "l"), "file");
    return true;
  } catch {
    return false;
  } finally {
    await rm(d, { recursive: true, force: true });
  }
}
const LN = await canSymlink();

describe("#existing không theo symlink [RV-10]", () => {
  test.skipIf(!LN)(
    "<tenant>/<id> là symlink tới file ngoài gốc ⇒ open/blob null (không coi là file có sẵn)",
    async () => {
      const dir = await temp();
      const out = await temp();
      await writeFile(join(out, "secret"), "secret");
      const s = await createLocalStorage({ dir });
      await mkdir(join(dir, T), { recursive: true });
      await symlink(join(out, "secret"), join(dir, T, id(1)), "file");
      expect(await s.open(`${T}/${id(1)}`)).toBeNull();
      expect(await s.blob(`${T}/${id(1)}`, "application/pdf")).toBeNull();
      await writeFile(join(dir, T, id(2)), "ok");
      expect((await s.open(`${T}/${id(2)}`))?.size).toBe(2);
    },
  );
});
