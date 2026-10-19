// F1 (CR-095) · cờ module đóng băng của admin-api (docs/platform/modules.md): `frozenModules:false` ⇒ workflows/commands/export/import không mount (404);
// bật (mặc định in-process) ⇒ route có mặt (401 vì chưa đăng nhập). Không cần DB: kết nối lười, request dừng ở middleware auth.
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createDb } from "@ai/db";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { loadJwtKeys } from "./lib/jwt";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pem = (k: typeof privateKey | typeof publicKey, type: "pkcs8" | "spki") =>
  k.export({ format: "pem", type }).toString();
const keys = await loadJwtKeys({
  JWT_PRIVATE_KEY: pem(privateKey, "pkcs8"),
  JWT_PUBLIC_KEY: pem(publicKey, "spki"),
  JWT_KID: "f1",
});
const db = createDb("postgres://admin_api:x@127.0.0.1:1/none", { max: 1 });
const app = (frozenModules?: boolean) =>
  createApp(
    { version: "0", corsOrigins: [] },
    {
      db,
      keys,
      appEnv: "test",
      dummyHash: "x",
      ...(frozenModules === undefined ? {} : { frozenModules }),
    },
  );
const PATHS = ["/admin/workflows", "/admin/commands", "/admin/export", "/admin/import"];

describe("F1 · ADMIN_FROZEN_MODULES", () => {
  test("env: mặc định off", () => {
    const env = loadEnv({
      APP_ENV: "development",
      PORT: "3001",
      CORS_ORIGINS: "http://localhost:3000",
      ADMIN_API_DATABASE_URL: "postgres://admin_api:x@localhost:5432/ai_system",
      JWT_PRIVATE_KEY: pem(privateKey, "pkcs8"),
      JWT_PUBLIC_KEY: pem(publicKey, "spki"),
      JWT_KID: "f1",
      SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
    });
    expect(env.ADMIN_FROZEN_MODULES).toBe("off");
  });

  test("frozenModules:false ⇒ 404; mặc định ⇒ route có mặt (401)", async () => {
    for (const p of PATHS) {
      expect({ p, s: (await app(false).request(p)).status }).toEqual({ p, s: 404 });
      expect({ p, s: (await app().request(p)).status }).not.toEqual({ p, s: 404 });
    }
  });

  test("route hoạt động (users) vẫn mount khi đóng băng", async () => {
    expect((await app(false).request("/admin/users")).status).not.toBe(404);
  });
});
