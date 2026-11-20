// CR-195 · cache Blob tệp theo phiên: trúng cache, đẩy ra khi vượt trần, dùng chung lượt tải, xoá khi hết phiên.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  cachedFileBlob,
  clearFileBlobs,
  FILE_BLOB_MAX_COUNT,
  fileBlobStats,
} from "./file-blob-cache";

const blob = (n: number) => new Blob([new Uint8Array(n)]);
beforeEach(() => clearFileBlobs());

describe("cache Blob tệp (CR-195)", () => {
  it("[CR-195] lần hai cùng id không tải lại (trúng cache)", async () => {
    let n = 0;
    const load = async () => (n++, blob(10));
    const a = await cachedFileBlob("f1", load);
    const b = await cachedFileBlob("f1", load);
    expect(n).toBe(1);
    expect(b).toBe(a);
  });

  it("[CR-195] hai chỗ cùng xin một id đang tải ⇒ chỉ một lượt mạng; lỗi không bị giữ", async () => {
    let n = 0;
    const slow = async () => {
      n++;
      await Promise.resolve();
      return blob(5);
    };
    await Promise.all([cachedFileBlob("f2", slow), cachedFileBlob("f2", slow)]);
    expect(n).toBe(1);
    const fail = async () => {
      throw new Error("404");
    };
    await expect(cachedFileBlob("f3", fail)).rejects.toThrow();
    let m = 0;
    await cachedFileBlob("f3", async () => (m++, blob(1)));
    expect(m).toBe(1);
  });

  it("[CR-195] vượt số mục ⇒ đẩy mục cũ nhất ra, mục vừa dùng được giữ", async () => {
    await cachedFileBlob("giu", async () => blob(1));
    for (let i = 0; i < FILE_BLOB_MAX_COUNT - 1; i++)
      await cachedFileBlob(`x${i}`, async () => blob(1));
    await cachedFileBlob("giu", async () => blob(1)); // chạm ⇒ mới nhất
    await cachedFileBlob("moi", async () => blob(1)); // vượt ⇒ đẩy x0
    expect(fileBlobStats().count).toBe(FILE_BLOB_MAX_COUNT);
    let n = 0;
    await cachedFileBlob("giu", async () => (n++, blob(1)));
    await cachedFileBlob("x0", async () => (n++, blob(1)));
    expect(n).toBe(1); // chỉ x0 bị tải lại
  });

  it("[CR-195] xoá khi hết phiên: không còn mục nào, tải dở của phiên cũ không ghi vào phiên mới", async () => {
    await cachedFileBlob("a", async () => blob(3));
    let release: (b: Blob) => void = () => {};
    const pending = cachedFileBlob("b", () => new Promise<Blob>((r) => (release = r)));
    clearFileBlobs();
    expect(fileBlobStats()).toEqual({ count: 0, bytes: 0 });
    release(blob(9));
    await pending;
    expect(fileBlobStats()).toEqual({ count: 0, bytes: 0 });
  });
});
