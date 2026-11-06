// CR-121 c21 (D4) · int (DB test, role hub_api): kho secret Hub là nguồn cấu hình mail duy nhất.
//  - seed từ env MỘT lần: kho trống ⇒ chép; lần 2 (giá trị khác) ⇒ không ghi đè; có secret sẵn (tên khác) ⇒ giữ nguyên;
//  - hai instance seed đồng thời ⇒ đúng một hàng; đọc qua `mailConfigReader` giải mã đúng;
//  - ops check `notify_config`: kho trống ⇒ warn, sau seed ⇒ ok.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { notifyConfigCheck } from "../../ops/adapters/checks/notify-config.check";
import { runChecksOnce } from "../../ops/application/ops.round";
import { opsRoundDeps } from "../../ops/ops.mount";
import { parseHubSecretsKey, sealHubSecret } from "../../secrets/secrets.crypto";
import { HubSecretReader } from "../../secrets/secrets.use";
import { hubCredentials } from "./credentials";
import {
  encodeMailConfig,
  type MailConfig,
  MailConfigInvalid,
  mailConfigReader,
  type SealSecret,
  seedMailSecret,
} from "./mail-config";

let o: Sql;
let db: Db;
const key = parseHubSecretsKey(randomBytes(32).toString("base64"));
const A: MailConfig = {
  smtp: { host: "smtp.a.test", port: 587, secure: false, user: "ua", from: "a@corp.vn" },
  password: "pw-a-123456",
};
const B: MailConfig = {
  smtp: { host: "smtp.b.test", port: 465, secure: true, user: "ub", from: "b@corp.vn" },
  password: "pw-b-654321",
};
const seal: SealSecret = (m, v) => sealHubSecret(key, m, v);
const read = () =>
  mailConfigReader(
    hubCredentials(db, new HubSecretReader({ db, key, log: { warn: () => {} } as never })),
  )();
const count = async () =>
  Number(
    (
      await o<
        { n: number }[]
      >`select count(*)::int as n from hub.secrets where kind = 'smtp_password' and tenant_id is null`
    )[0]?.n,
  );
const reset = () => o`delete from hub.secrets where kind = 'smtp_password'`;

let minute = 0;
const NOW = new Date("2026-11-06T08:00:00Z");
const round = async (): Promise<{ status: string; message: string }> => {
  await o`update hub.ops_settings set last_round_at = null where id = 1`;
  await runChecksOnce(
    opsRoundDeps({
      db,
      ops: { checks: [notifyConfigCheck], timeoutMs: 5_000 },
      log: console as never,
    }),
    new Date(NOW.getTime() + 31 * 60_000 * minute++),
  );
  const [r] = await o<
    { status: string; message: string }[]
  >`select status, message from hub.ops_checks where check_key = 'notify_config'`;
  return r as { status: string; message: string };
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 c21 · seed cấu hình mail vào kho secret", () => {
  it("kho trống ⇒ seeded (đọc lại đúng), lần 2 giá trị khác ⇒ exists, KHÔNG ghi đè", async () => {
    await reset();
    expect(await seedMailSecret(db, seal, A)).toBe("seeded");
    expect(await read()).toEqual(A);
    expect(await seedMailSecret(db, seal, B)).toBe("exists");
    expect(await seedMailSecret(db, seal, A)).toBe("exists");
    expect(await read()).toEqual(A);
    expect(await count()).toBe(1);
  });

  it("đã có secret mail sẵn (tên khác do người vận hành tạo) ⇒ giữ nguyên, seed không thêm hàng", async () => {
    await reset();
    const id = crypto.randomUUID();
    const s = sealHubSecret(
      key,
      { id, kind: "smtp_password", tenantId: null },
      encodeMailConfig(B),
    );
    await o`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version)
      values (${id}, 'smtp_password', null, 'ops-tao-tay', ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, ${s.keyVersion})`;
    expect(await seedMailSecret(db, seal, A)).toBe("exists");
    expect(await count()).toBe(1);
    expect(await read()).toEqual(B);
  });

  it("hai instance seed đồng thời ⇒ đúng một hàng", async () => {
    await reset();
    const r = await Promise.all([seedMailSecret(db, seal, A), seedMailSecret(db, seal, B)]);
    expect(r.filter((x) => x === "seeded")).toHaveLength(1);
    expect(await count()).toBe(1);
  });
});

describe("CR-121 c21 · ops check notify_config", () => {
  it("kho trống ⇒ warn 'Chưa cấu hình mail', sau seed ⇒ ok", async () => {
    await reset();
    const bad = await round();
    expect(bad.status).toBe("warn");
    expect(bad.message).toContain("Chưa cấu hình mail");
    await seedMailSecret(db, seal, A);
    expect((await round()).status).toBe("ok");
  });

  it("secret kiểu cũ (mật khẩu thô) ⇒ đọc lỗi MailConfigInvalid, check warn riêng, tạo lại đúng định dạng ⇒ ok", async () => {
    await reset();
    const id = crypto.randomUUID();
    const s = sealHubSecret(
      key,
      { id, kind: "smtp_password", tenantId: null },
      "mat-khau-tron-kieu-cu",
    );
    await o`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version)
      values (${id}, 'smtp_password', null, 'kieu-cu', ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, ${s.keyVersion})`;
    const err = await read().then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(MailConfigInvalid);
    const bad = await round();
    expect(bad.status).toBe("warn");
    expect(bad.message).toContain("không đọc được");
    await reset();
    await seedMailSecret(db, seal, A);
    expect(await read()).toEqual(A);
    expect((await round()).status).toBe("ok");
  });
});
