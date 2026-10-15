// HUB-FR-138 · HUB-FR-141 · FB1-AC-03 (vế env) · AC-09 · AC-11 (vế `fileboxRetryable`) · spec §3.1, §3.6, §4.5, §4.7: hàm thuần locator
// (`fileboxLocator`, `parseFileboxLocator`, `storageLocatorOf`, `isFileboxRow`, `fileboxRetryable` ở `storage.ts`), `parseAttachEnv`
// (driver `filebox` + allowlist egress `149.202.83.5:9443`, `:9000` KHÔNG được; `local` giữ nguyên), kiểm tĩnh: không `rejectUnauthorized:false`.
// Không cần DB. Hàm chưa có ⇒ `typeof … === 'function'` đỏ ở expect (nạp động, không đỏ ở typecheck).
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseAttachEnv } from "../../../apps/hub-api/src/modules/attachments/attach-env.rules";
import { isStorageKey, storageKey } from "../../../apps/hub-api/src/modules/attachments/storage";
import { ROOT } from "../M1/_modules";
import { loadStorageRules, tryLoad } from "./_fb1";

const TENANT = "a0000000-0000-4000-8000-000000000001";
const ID = "b0000000-0000-4000-8000-0000000000aa";
const ATT_DIR = join(ROOT, "apps/hub-api/src/modules/attachments");
const SRC = join(ROOT, "apps/hub-api/src");
const srcFiles = () =>
  [...new Bun.Glob("**/*.ts").scanSync(SRC)].filter((f) => !/\.test\.ts$/.test(f));

describe("HUB-FR-138 · hàm thuần locator [spec §4.7]", () => {
  it("HUB-FR-138 · FB1-AC-01 · r1 · fileboxLocator(fileId, versionId) → 'fb/<f>/<v>'; versionId null → 'fb/<f>'", async () => {
    const m = await loadStorageRules();
    expect(typeof m.fileboxLocator).toBe("function");
    expect(m.fileboxLocator("F1", "V1")).toBe("fb/F1/V1");
    expect(m.fileboxLocator("F1", null)).toBe("fb/F1");
  });

  it("HUB-FR-138 · r2 · parseFileboxLocator: khứ hồi; khoá local 'tenant/id' hoặc rác → null", async () => {
    const m = await loadStorageRules();
    expect(typeof m.parseFileboxLocator).toBe("function");
    expect(m.parseFileboxLocator("fb/F1/V1")).toEqual({ fileId: "F1", versionId: "V1" });
    expect(m.parseFileboxLocator("fb/F1")).toEqual({ fileId: "F1", versionId: null });
    expect(m.parseFileboxLocator(`${TENANT}/${ID}`)).toBeNull();
    expect(m.parseFileboxLocator("fb/")).toBeNull();
    expect(m.parseFileboxLocator("")).toBeNull();
  });

  it("HUB-FR-138 · FB1-AC-03 · r3 · storageLocatorOf: có filebox_file_id → 'fb/…'; không → storage_key (hàng local không đổi)", async () => {
    const m = await loadStorageRules();
    expect(typeof m.storageLocatorOf).toBe("function");
    const key = storageKey(TENANT, ID);
    expect(
      m.storageLocatorOf({ storage_key: key, filebox_file_id: null, filebox_version_id: null }),
    ).toBe(key);
    expect(
      m.storageLocatorOf({ storage_key: key, filebox_file_id: "F9", filebox_version_id: "V9" }),
    ).toBe("fb/F9/V9");
    expect(
      m.storageLocatorOf({ storage_key: key, filebox_file_id: "F9", filebox_version_id: null }),
    ).toBe("fb/F9");
  });

  it("HUB-FR-138 · r4 · isFileboxRow ⇔ filebox_file_id != null", async () => {
    const m = await loadStorageRules();
    expect(typeof m.isFileboxRow).toBe("function");
    expect(m.isFileboxRow({ filebox_file_id: "F" })).toBe(true);
    expect(m.isFileboxRow({ filebox_file_id: null })).toBe(false);
  });

  it("HUB-FR-138 · FB1-AC-03 · r5 · khoá local không đổi: storageKey = 'tenant/id', isStorageKey đúng; 'fb/…' KHÔNG phải storage key local", () => {
    expect(storageKey(TENANT, ID)).toBe(`${TENANT}/${ID}`);
    expect(isStorageKey(`${TENANT}/${ID}`)).toBe(true);
    expect(isStorageKey("fb/F1/V1")).toBe(false);
  });

  it("HUB-FR-138 · FB1-AC-11 · r6 · fileboxRetryable: 500/502/503/504 và lỗi mạng (null) → true; 200/201/204/401/403/404/413/422 → false", async () => {
    const m = await loadStorageRules();
    expect(typeof m.fileboxRetryable).toBe("function");
    for (const s of [500, 502, 503, 504, null])
      expect({ s, r: m.fileboxRetryable(s) }).toEqual({ s, r: true });
    for (const s of [200, 201, 204, 401, 403, 404, 413, 422])
      expect({ s, r: m.fileboxRetryable(s) }).toEqual({ s, r: false });
  });

  it("HUB-FR-138 · r7 · FileboxUnavailable là Error (người gọi map INTERNAL_ERROR)", async () => {
    const m = await loadStorageRules();
    expect(typeof m.FileboxUnavailable).toBe("function");
    expect(new m.FileboxUnavailable("x")).toBeInstanceOf(Error);
  });
});

const loc = { HUB_ATTACH_DIR: "/var/lib/hub/attach" };
const fb = (o: Record<string, string | undefined> = {}) =>
  ({
    HUB_ATTACH_DRIVER: "filebox",
    ...loc,
    FILEBOX_URL: "https://149.202.83.5:9443",
    FILEBOX_ORG: "ai-system",
    FILEBOX_CA: "/etc/ssl/filebox.crt",
    FILEBOX_TOKEN: "fb-env-token-Zx9Pq7Lm",
    ...o,
  }) as never;

describe("FB1-AC-09 · env + allowlist egress [HUB-FR-141 · §3.6, §4.5]", () => {
  it("HUB-FR-141 · FB1-AC-09 · e1 · HUB_ATTACH_DRIVER=filebox + FILEBOX_URL https://149.202.83.5:9443 + org + CA → driver 'filebox'", () => {
    expect((parseAttachEnv(fb(), "linux") as { driver: string }).driver).toBe("filebox");
  });

  it("HUB-FR-141 · FB1-AC-09 · e2 · https bắt buộc: http:// tới host không phải loopback ⇒ ném (cổng/IP cụ thể là hạ tầng, KHÔNG kiểm ở app)", () => {
    expect(throws(() => parseAttachEnv(fb(), "linux"))).toBe(false); // đối chứng: https hợp lệ
    for (const url of [
      "http://149.202.83.5:9443",
      "http://evil.example",
      "ftp://149.202.83.5:9443",
      "khong-phai-url",
    ])
      expect({
        url,
        throws: throws(() => parseAttachEnv(fb({ FILEBOX_URL: url }), "linux")),
      }).toEqual({ url, throws: true });
  });

  it("HUB-FR-141 · FB1-AC-09 · e3 · thông điệp lỗi chỉ nêu TÊN biến, không chứa giá trị URL/host", () => {
    try {
      parseAttachEnv(fb({ FILEBOX_URL: "http://evil.example:9443" }), "linux");
      throw new Error("không ném");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("FILEBOX_URL");
      expect(msg).not.toContain("evil.example");
    }
  });

  it("HUB-FR-141 · FB1-AC-09 · e4 · thiếu FILEBOX_URL hoặc FILEBOX_ORG khi driver=filebox ⇒ ném", () => {
    expect(throws(() => parseAttachEnv(fb(), "linux"))).toBe(false); // đối chứng
    expect(throws(() => parseAttachEnv(fb({ FILEBOX_URL: undefined }), "linux"))).toBe(true);
    expect(throws(() => parseAttachEnv(fb({ FILEBOX_ORG: undefined }), "linux"))).toBe(true);
    // token lấy từ env FILEBOX_TOKEN (scope core-only): thiếu ⇒ fail-closed ở cấu hình, lỗi chỉ nêu TÊN biến
    try {
      parseAttachEnv(fb({ FILEBOX_TOKEN: undefined }), "linux");
      throw new Error("không ném");
    } catch (e) {
      expect((e as Error).message).toContain("FILEBOX_TOKEN");
    }
    try {
      parseAttachEnv(
        fb({ FILEBOX_URL: "http://evil.example", FILEBOX_TOKEN: "fb-env-token-Zx9Pq7Lm" }),
        "linux",
      );
      throw new Error("không ném");
    } catch (e) {
      expect((e as Error).message).not.toContain("fb-env-token-Zx9Pq7Lm");
    }
  });

  it("HUB-FR-141 · FB1-AC-09 · e5 · mock test: http://127.0.0.1:<port> được chấp nhận (bỏ CA/pin, không áp allowlist IP thật)", () => {
    const r = parseAttachEnv(
      fb({ FILEBOX_URL: "http://127.0.0.1:45123", FILEBOX_CA: undefined }),
      "linux",
    );
    expect((r as { driver: string }).driver).toBe("filebox");
  });

  it("HUB-FR-141 · FB1-AC-03 · e6 · hồi quy: HUB_ATTACH_DRIVER=local vẫn hợp lệ; driver lạ (s3) vẫn bị từ chối", () => {
    const l = parseAttachEnv({ HUB_ATTACH_DRIVER: "local", ...loc } as never, "linux") as {
      driver: string;
      dir: string;
    };
    expect(l).toMatchObject({ driver: "local", dir: "/var/lib/hub/attach" });
    expect(
      throws(() => parseAttachEnv({ HUB_ATTACH_DRIVER: "s3", ...loc } as never, "linux")),
    ).toBe(true);
  });

  it("HUB-FR-141 · FB1-AC-09 · e7 · kiểm tĩnh: modules/attachments có client/driver FileBox; toàn apps/hub-api/src KHÔNG đặt rejectUnauthorized:false hay NODE_TLS_REJECT_UNAUTHORIZED", async () => {
    const att = [...new Bun.Glob("**/*.ts").scanSync(ATT_DIR)].filter(
      (f) => !/\.test\.ts$/.test(f),
    );
    expect(att.some((f) => /filebox/i.test(f))).toBe(true);
    const bad: string[] = [];
    for (const f of srcFiles()) {
      const t = await Bun.file(join(SRC, f)).text();
      if (/rejectUnauthorized\s*:\s*false/.test(t) || /NODE_TLS_REJECT_UNAUTHORIZED/.test(t))
        bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it("HUB-FR-141 · FB1-AC-09 · e8 · fileboxUrlOk(base, url): chỉ cùng origin với FILEBOX_URL (scheme+host+port) mới được gọi/theo; origin khác, scheme khác, userinfo lạ ⇒ false", async () => {
    const m = await tryLoad("apps/hub-api/src/modules/attachments/filebox.client.ts");
    expect(typeof m.fileboxUrlOk).toBe("function");
    const base = "https://149.202.83.5:9443";
    expect(m.fileboxUrlOk(base, "https://149.202.83.5:9443/files/abc/content")).toBe(true);
    expect(m.fileboxUrlOk(base, "https://149.202.83.5:9443/d/xyz")).toBe(true);
    for (const u of [
      "https://149.202.83.5:9000/files/abc",
      "https://evil.example:9443/d/xyz",
      "http://149.202.83.5:9443/files/abc",
      "https://149.202.83.5.evil.example:9443/d/x",
      "https://user@149.202.83.5:9443@evil.example/",
    ])
      expect({ u, ok: m.fileboxUrlOk(base, u) }).toEqual({ u, ok: false });
  });
});

function throws(f: () => unknown): boolean {
  try {
    f();
    return false;
  } catch {
    return true;
  }
}
