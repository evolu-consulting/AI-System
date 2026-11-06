// CR-122 p9 · FLOW2-FR-27 · route multipart thật: 3 ảnh ⇒ 1 PDF lưu FileBox; > 50 ảnh ⇒ 422 FILE_TOO_MANY_PAGES không lưu gì;
// HEIC ⇒ 415 báo đúng tên định dạng. FileBox giả FB1, DB test của ô (khuôn `upload.int.test.ts`). Ảnh PNG tự tạo.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { zlibSync } from "fflate";
import { arrange, CBASE, type CtxN1, P, startHd1 } from "./_support/hd1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const enc = (s: string) => new TextEncoder().encode(s);
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(enc(type), 4);
  out.set(body, 8);
  return out;
}
/** PNG RGB 4×4 hợp lệ (CRC không kiểm); `seed` làm mỗi ảnh khác nội dung. */
function png(seed: number): Uint8Array {
  const raw = new Uint8Array(4 * (1 + 12));
  for (let i = 0; i < raw.length; i++) raw[i] = i % 13 === 0 ? 0 : (i * 7 + seed) & 255;
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 4);
  new DataView(ihdr.buffer).setUint32(4, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function post(files: { name: string; bytes: Uint8Array; type: string }[]) {
  const fd = new FormData();
  for (const f of files)
    fd.append("file", new File([f.bytes as unknown as BlobPart], f.name, { type: f.type }));
  const res = await fetch(`${c.hub.base}${CBASE}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(P.hoa)}` },
    body: fd,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
const rows = async () =>
  (await c.sql`select count(*)::int as n from contracts.contracts`)[0]?.n as number;

describe("p9 · tải nhiều ảnh (route multipart)", () => {
  it("3 ảnh PNG ⇒ 201, MỘT PDF lưu FileBox (1 lần post), 1 hợp đồng mime pdf đang 'extracting'", async () => {
    await arrange(c);
    const r = await post(
      [1, 2, 3].map((n) => ({ name: `trang-${n}.png`, bytes: png(n), type: "image/png" })),
    );
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("extracting");
    expect(c.fb.callsTo("post")).toHaveLength(1);
    const [f] = await c.sql`
      select f.name, f.mime from contracts.contracts k join contracts.files f on f.id = k.file_id where k.id = ${r.json.id}`;
    expect(f).toMatchObject({ name: "trang-1.pdf", mime: "application/pdf" });
    expect(await rows()).toBe(1);
  });
  it("51 ảnh (> trần 50 trang) ⇒ 422 FILE_TOO_MANY_PAGES {pages, limit}; không FileBox, không hợp đồng", async () => {
    await arrange(c);
    const r = await post(
      Array.from({ length: 51 }, (_, n) => ({
        name: `t${n}.png`,
        bytes: png(n),
        type: "image/png",
      })),
    );
    expect(r.status).toBe(422);
    expect(r.json.code ?? r.json.error?.code).toBe("FILE_TOO_MANY_PAGES");
    expect(c.fb.callsTo("post")).toEqual([]);
    expect(await rows()).toBe(0);
  });
  it("HEIC ⇒ 415 và câu báo nêu đúng định dạng (không lưu gì)", async () => {
    await arrange(c);
    const heic = new Uint8Array([0, 0, 0, 24, ...enc("ftypheic"), 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = await post([{ name: "a.heic", bytes: heic, type: "image/heic" }]);
    expect(r.status).toBe(415);
    expect(JSON.stringify(r.json)).toContain("HEIC");
    expect(c.fb.callsTo("post")).toEqual([]);
    expect(await rows()).toBe(0);
  });
});
