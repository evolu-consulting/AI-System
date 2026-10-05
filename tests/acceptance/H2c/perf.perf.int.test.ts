// HUB-FR-44 · ngân sách spec H2c §6 / plan §7 (test-plan-int §2.16 PF1–PF3; không chặn mốc, chạy bằng `bun run test:perf`):
// `POST /attachments` 20 MiB p95 ≤ 1,5 s, RSS tăng ≤ 8 MiB/upload (stream, không giữ thân trong RAM); E12 có 10 id (R09 + R11)
// thêm ≤ 5 ms p95 so với không id; `sweepOnce` lô 500 (hàng hết hạn + file 1 KB) ≤ 2 s.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sweepOnce } from "../../../apps/hub-api/src/modules/attachments/sweeper";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { insertConv } from "../H1/_hub";
import { settleRuns } from "../H2b/_h2b";
import { quantile } from "../H2b/_stream";
import {
  DAY_MS,
  expectStorage,
  type HubC,
  insertAttachmentRow,
  MAX,
  sample,
  sendWith,
  setupH2c,
  startHubH2c,
  upload,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
let token = "";

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k);
  token = await sign(k, USERS.lan);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

/** Thời gian tới header phản hồi E12 rồi dọn run. */
async function sendMs(content: string, ids?: string[]): Promise<{ ms: number; status: number }> {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const t0 = performance.now();
  const s = await sendWith(hub, token, conv, content, ids);
  const ms = performance.now() - t0;
  s.close();
  await settleRuns(hub, sql, k);
  return { ms, status: s.status };
}

describe("PF1–PF3 · hiệu năng H2c [spec §6 · plan §7]", () => {
  it("HUB-FR-44 · PF1 · POST /attachments 20 MiB × 10 → p95 ≤ 1,5 s; RSS tăng ≤ 8 MiB/upload [spec §6]", async () => {
    const body = sample.pdf(MAX);
    const xs: number[] = [];
    Bun.gc(true);
    const rss0 = process.memoryUsage().rss;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const r = await upload(hub, token, body, `perf-${i}.pdf`);
      xs.push(performance.now() - t0);
      expect(r.status).toBe(201);
    }
    Bun.gc(true);
    const perUpload = (process.memoryUsage().rss - rss0) / 10;
    expect(quantile(xs, 0.95)).toBeLessThanOrEqual(1_500);
    expect(perUpload).toBeLessThanOrEqual(8 * 1_048_576);
  }, 120_000);

  it("HUB-FR-44 · PF2 · E12 với 10 id − E12 không id: p95 thêm ≤ 5 ms (100 lần) [spec §6 · R09 · R11]", async () => {
    const plain: number[] = [];
    const withIds: number[] = [];
    for (let i = 0; i < 100; i++) {
      const ids: string[] = [];
      for (let j = 0; j < 10; j++) ids.push((await insertAttachmentRow(sql)).id);
      const a = await sendMs(`Không id PF2 ${i}`);
      const b = await sendMs(`Mười id PF2 ${i}`, ids);
      expect([a.status, b.status]).toEqual([200, 200]);
      const [bound] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments
        where id = any(${sql.array(ids, 2950)}) and message_id is not null`;
      expect(bound?.n).toBe(10);
      plain.push(a.ms);
      withIds.push(b.ms);
    }
    expect(quantile(withIds, 0.95) - quantile(plain, 0.95)).toBeLessThanOrEqual(5);
  }, 600_000);

  it("HUB-FR-44 · PF3 · sweepOnce lô 500 (hàng hết hạn + file 1 KB) ≤ 2 s [spec §6 · H2c-R27]", async () => {
    const storage = expectStorage(hub);
    for (let i = 0; i < 500; i++)
      await insertAttachmentRow(sql, {
        content: sample.pdf(1024),
        dir: hub.dir,
        createdAgoMs: DAY_MS + 60_000,
      });
    const t0 = performance.now();
    const r = await sweepOnce({ db: hub.db, storage, now: new Date() });
    const ms = performance.now() - t0;
    expect(r.expired).toBe(500);
    expect(ms).toBeLessThanOrEqual(2_000);
  }, 120_000);
});
