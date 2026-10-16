// HUB-FR-44 · CR-filebox · env driver `filebox` (`parseAttachEnv`): URL/khoá/org FileBox; lỗi không chứa giá trị env.
import { describe, expect, it } from "bun:test";
import { parseAttachEnv } from "./attach-env.rules";

const TOKEN = "tok_0123456789abcdef0123456789";
const base = {
  HUB_ATTACH_DRIVER: "filebox",
  FILEBOX_URL: "https://files.example.com:9443",
  FILEBOX_TOKEN: TOKEN,
  FILEBOX_ORG: "ai-system",
};

describe("HUB-FR-44 · parseAttachEnv driver filebox", () => {
  it("hợp lệ: url (bỏ / cuối), token, org; mặc định hạn mức như local; không cần HUB_ATTACH_DIR", () => {
    expect(
      parseAttachEnv({ ...base, FILEBOX_URL: "https://files.example.com:9443/" }, "linux"),
    ).toEqual({
      driver: "filebox",
      url: "https://files.example.com:9443",
      token: TOKEN,
      org: "ai-system",
      tenantMaxBytes: 5_368_709_120,
      sweepS: 600,
    });
  });

  it("FILEBOX_CA tuỳ chọn, phải tuyệt đối; http chỉ cho máy cục bộ", () => {
    expect(parseAttachEnv({ ...base, FILEBOX_CA: "/etc/filebox.crt" }, "linux")).toMatchObject({
      ca: "/etc/filebox.crt",
    });
    expect(
      parseAttachEnv({ ...base, FILEBOX_URL: "http://127.0.0.1:9443" }, "linux"),
    ).toMatchObject({
      url: "http://127.0.0.1:9443",
    });
  });

  it("sai → ném Error, message không chứa giá trị env", () => {
    const bad: Record<string, string | undefined>[] = [
      { FILEBOX_URL: undefined },
      { FILEBOX_URL: "files.example.com" },
      { FILEBOX_URL: "http://files.example.com" },
      { FILEBOX_URL: "ftp://files.example.com" },
      { FILEBOX_TOKEN: undefined },
      { FILEBOX_TOKEN: "short" },
      { FILEBOX_TOKEN: "has space inside the token" },
      { FILEBOX_ORG: undefined },
      { FILEBOX_ORG: "   " },
      { FILEBOX_ORG: "x".repeat(201) },
      { FILEBOX_CA: "rel/ca.crt" },
    ];
    for (const patch of bad) {
      let msg: string | null = null;
      try {
        parseAttachEnv({ ...base, ...patch }, "linux");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        msg = (e as Error).message;
      }
      expect(msg, JSON.stringify(patch)).not.toBeNull();
      for (const v of Object.values({ ...base, ...patch }))
        if (v && v.length > 3 && v !== "filebox") expect(msg).not.toContain(v);
    }
  });

  it("driver lạ vẫn bị từ chối, local giữ nguyên dạng cũ", () => {
    expect(() => parseAttachEnv({ ...base, HUB_ATTACH_DRIVER: "s3" }, "linux")).toThrow(
      /HUB_ATTACH_DRIVER/,
    );
    expect(
      parseAttachEnv({ HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: "/srv/a" }, "linux"),
    ).toEqual({
      driver: "local",
      dir: "/srv/a",
      tenantMaxBytes: 5_368_709_120,
      sweepS: 600,
    });
  });
});
