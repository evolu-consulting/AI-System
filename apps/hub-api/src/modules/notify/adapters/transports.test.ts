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
  test("off ⇒ null; fake ⇒ cặp transport giả; live ⇒ NotifyNotConfigured", () => {
    expect(transportsFor("off")).toBeNull();
    expect(transportsFor("fake")?.email).toBeInstanceOf(FakeEmailTransport);
    expect(() => transportsFor("live")).toThrow(NotifyNotConfigured);
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
  test("live ⇒ ném (server thoát ≠ 0, không lặng lẽ không gửi)", () => {
    expect(() => envAppDeps(env({ HUB_NOTIFY_MODE: "live" }), log)).toThrow(/ADR-0027/);
  });
});
