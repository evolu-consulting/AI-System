// N3-FR-07 · D-03 · chọn transport theo HUB_NOTIFY_MODE; `live` chưa có adapter ⇒ fail-closed (env và transportsFor).
import { describe, expect, test } from "bun:test";
import { loadEnv } from "../../../config/env";
import { envAppDeps } from "../../../config/env-deps";
import { FakeEmailTransport } from "./transport.fake";
import { NotifyNotConfigured, transportsFor } from "./transports";

const baseEnv = {
  HUB_DATABASE_URL: "postgres://x@localhost/x",
  REDIS_URL: "redis://localhost:6379",
  JWT_PUBLIC_KEY:
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsecretvalue\n-----END PUBLIC KEY-----",
  APP_ENV: "development",
};
const log = { warn: () => {} };

describe("transportsFor", () => {
  test("off ⇒ null; fake ⇒ cặp transport giả; live thiếu cấu hình ⇒ NotifyNotConfigured; live có cấu hình ⇒ transport thật", () => {
    expect(transportsFor("off")).toBeNull();
    expect(transportsFor("fake")?.email).toBeInstanceOf(FakeEmailTransport);
    expect(() => transportsFor("live")).toThrow(NotifyNotConfigured);
    const live = transportsFor("live", {
      mail: async () => ({
        smtp: { host: "h", port: 587, secure: false, user: "", from: "a@b.test" },
        password: "",
      }),
      vapid: null,
      vapidPrivateKey: async () => undefined,
    });
    expect(live?.email).toBeDefined();
    expect(live?.email).not.toBeInstanceOf(FakeEmailTransport);
  });
});

describe("envAppDeps · notify", () => {
  const env = (extra: Record<string, string>) => loadEnv({ ...baseEnv, ...extra } as never);
  test("mặc định off, không worker; fake ⇒ worker bật, base URL mặc định", () => {
    const off = envAppDeps(env({}), log).notify;
    expect(off).toMatchObject({ mode: "off", worker: false, vapidPublicKey: null });
    const fake = envAppDeps(
      env({ HUB_NOTIFY_MODE: "fake", HUB_VAPID_PUBLIC_KEY: "BPub" }),
      log,
    ).notify;
    expect(fake).toMatchObject({ mode: "fake", worker: true, vapidPublicKey: "BPub" });
  });
  test("live khởi động được; env mail chỉ thành mailSeed (có SMTP_PASSWORD mới seed), không còn cấu hình gửi từ env", () => {
    const d = envAppDeps(env({ HUB_NOTIFY_MODE: "live" }), log).notify;
    expect(d?.live?.mailSeed).toBeNull();
    expect(d?.live?.vapid).toBeNull();
    expect(d?.live).not.toHaveProperty("smtp");
    const withPw = envAppDeps(
      env({ HUB_NOTIFY_MODE: "live", SMTP_PASSWORD: "p", HUB_VAPID_PUBLIC_KEY: "BPub" }),
      log,
    ).notify;
    expect(withPw?.live?.mailSeed).toEqual({
      smtp: {
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        user: "",
        from: "no-reply@example.com",
      },
      password: "p",
    });
    expect(withPw?.live?.vapid?.publicKey).toBe("BPub");
  });
  test("fake bị từ chối ở production", () => {
    expect(() => envAppDeps(env({ HUB_NOTIFY_MODE: "fake", APP_ENV: "production" }), log)).toThrow(
      /production/,
    );
  });
});
