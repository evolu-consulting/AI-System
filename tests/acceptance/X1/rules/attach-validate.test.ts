// X1-AC07 · HUB-FR-44 · `validateAttachment(file, existing)` → `{ok} | {error}` (plan-frontend §1.1b, §1.6 "Chặn sớm"):
// đuôi ∉ ATTACH_ALLOWED, > ATTACH_MAX_BYTES, 0 B, tên > ATTACH_FILENAME_MAX, quá ATTACH_PER_MESSAGE_MAX ⇒ lỗi.
// Tệp sinh lúc chạy. Nạp động (P7) ⇒ đỏ "Cannot find module" tới khi F3 xong.
import { describe, expect, it } from "bun:test";
import { ATTACH_FILENAME_MAX, ATTACH_MAX_BYTES, ATTACH_PER_MESSAGE_MAX } from "@ai/contracts/chat";
import { type Loose, loadAttachValidate } from "../_modules";

const file = (name: string, size: number, type = "") =>
  new File([new Uint8Array(size)], name, { type });
const check = async (f: File, existing: File[] = []): Promise<Loose> =>
  (await loadAttachValidate()).validateAttachment(f, existing);
const isOk = (r: Loose) => r.ok === true && !("error" in r && r.error);
const isErr = (r: Loose) => r.ok !== true && "error" in r && Boolean(r.error);

describe("X1-AC07 · validateAttachment", () => {
  it("X1-AC07 · a.txt 1 KB, b.pdf 1 KB ⇒ ok; đúng giới hạn 20 MiB ⇒ ok", async () => {
    expect(isOk(await check(file("a.txt", 1024)))).toBe(true);
    expect(isOk(await check(file("b.pdf", 1024)))).toBe(true);
    expect(isOk(await check(file("lon.pdf", ATTACH_MAX_BYTES)))).toBe(true);
  });

  it("X1-AC07 · x.exe ⇒ lỗi (đuôi lạ, không tin file.type)", async () => {
    expect(isErr(await check(file("x.exe", 10, "text/plain")))).toBe(true);
    expect(isErr(await check(file("khong-duoi", 10, "text/plain")))).toBe(true);
  });

  it("X1-AC07 · 20 MiB + 1 byte ⇒ lỗi; tệp rỗng 0 B ⇒ lỗi", async () => {
    expect(isErr(await check(file("qua-lon.pdf", ATTACH_MAX_BYTES + 1)))).toBe(true);
    expect(isErr(await check(file("rong.txt", 0)))).toBe(true);
  });

  it("X1-AC07 · tên 201 ký tự ⇒ lỗi; tên đúng 200 ký tự ⇒ ok", async () => {
    const long = `${"a".repeat(ATTACH_FILENAME_MAX - 3)}.txt`; // 201
    expect(long.length).toBe(ATTACH_FILENAME_MAX + 1);
    expect(isErr(await check(file(long, 10)))).toBe(true);
    const fit = `${"a".repeat(ATTACH_FILENAME_MAX - 4)}.txt`;
    expect(isOk(await check(file(fit, 10)))).toBe(true);
  });

  it("X1-AC07 · đã có 10 tệp ⇒ tệp thứ 11 lỗi; 9 tệp ⇒ tệp thứ 10 ok", async () => {
    const ten = Array.from({ length: ATTACH_PER_MESSAGE_MAX }, (_, i) => file(`f${i}.txt`, 1));
    expect(isErr(await check(file("f10.txt", 1), ten))).toBe(true);
    expect(isOk(await check(file("f9b.txt", 1), ten.slice(0, 9)))).toBe(true);
  });
});
