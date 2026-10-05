// HUB-FR-44 · H2c-R27–R29 · PL2 · PL11 · PL13 · HUB-H2c-AC-13 · test-plan-int §2.13 A120–A129: dọn file qua
// `sweepOnce({db: hub.db, storage, now, log})` (đồng hồ tiêm, vòng nền tắt — L1): chưa gắn quá 24 h → xoá file + hàng; hội
// thoại xoá → `purged_at`, nội dung mất, hàng còn; mồ côi (`.part`/file không hàng > 1 h; `.part` có hàng sống → rename);
// hàng purged mà file mất; lô 500; khoá toàn cục (`skipped`); `remove` lỗi → `warn`, lượt sau dọn.
// Dữ liệu: hàng SQL owner + file ghi thẳng `<dir>/<tenant>/<id>` (mtime bằng `utimes` — Q-T4).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chmod, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../../../apps/hub-api/src/lib/logger";
import { sweepOnce } from "../../../apps/hub-api/src/modules/attachments/sweeper";
import { call, type Json, type Keys, makeKeys, type Sql, sign, T, USERS } from "../H1/_fixtures";
import { insertConv, insertFlow, runIdOf } from "../H1/_hub";
import { captureLogs, type LogLine, settleRuns } from "../H2b/_h2b";
import {
  attRow,
  DAY_MS,
  diskFiles,
  expectStorage,
  type HubC,
  insertAttachmentRow,
  pathOf,
  sample,
  sendWith,
  setupH2c,
  startHubH2c,
  userMessages,
  writeStored,
} from "./_h2c";

const WIN = process.platform === "win32";
const HOUR = 3_600_000;
let sql: Sql;
let k: Keys;
let hub: HubC;
let token = "";
let log: { lines: LogLine[]; restore: () => void };

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k);
  token = await sign(k, USERS.lan);
}, 60_000);
beforeEach(() => {
  log = captureLogs();
});
afterEach(async () => {
  log.restore();
  await settleRuns(hub, sql, k);
});
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

/** Một lượt với đồng hồ tiêm (`log` = logger hub-api, bắt bằng `captureLogs`). */
const sweep = (now: Date) =>
  sweepOnce({ db: hub.db, storage: expectStorage(hub), now, log: logger });
const rowCreated = async (id: string): Promise<number> =>
  (await attRow(sql, id)).created_at.getTime();
const exists = (key: string) => Bun.file(pathOf(hub.dir, key)).exists();
const stored = (o: Parameters<typeof insertAttachmentRow>[1] = {}) =>
  insertAttachmentRow(sql, { content: sample.pdf(2048), dir: hub.dir, ...o });
/** Flow 1 tin user trong hội thoại mới của lan. */
async function boundFlow() {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
    msgs: [{ role: "user", content: "có file" }],
  });
  const [m] = await userMessages(sql, flow);
  return {
    conv,
    flow,
    bind: { messageId: m?.id ?? "", conversationId: conv, flowId: flow, position: 0 },
  };
}
const mtime = (p: string, agoMs: number) => {
  const t = new Date(Date.now() - agoMs);
  return utimes(p, t, t);
};

describe("A120–A124 · hết hạn, hội thoại xoá [H2c-R27 · R28 · AC-13]", () => {
  it("HUB-FR-44 · A120 · upload chưa gắn: now = created_at + 24 h − 1 s → còn; + 24 h + 1 s → file và hàng mất [AC-13 · H2c-R27]", async () => {
    const a = await stored();
    const t = await rowCreated(a.id);
    await sweep(new Date(t + DAY_MS - 1_000));
    expect({ row: !!(await attRow(sql, a.id)), file: await exists(a.key) }).toEqual({
      row: true,
      file: true,
    });
    const r = await sweep(new Date(t + DAY_MS + 1_000));
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect({ row: !!(await attRow(sql, a.id)), file: await exists(a.key) }).toEqual({
      row: false,
      file: false,
    });
  });

  it("HUB-FR-44 · A121 · output chưa gắn (run huỷ) cũng xoá như A120 [H2c-R27]", async () => {
    const a = await stored({ origin: "output" });
    const t = await rowCreated(a.id);
    await sweep(new Date(t + DAY_MS + 1_000));
    expect({ row: !!(await attRow(sql, a.id)), file: await exists(a.key) }).toEqual({
      row: false,
      file: false,
    });
  });

  it("HUB-FR-44 · A122 · hội thoại xoá (DELETE /conversations/:id) → sau 1 lượt: nội dung mất, purged_at = now, hàng còn; A123 · GET và /content 404 [AC-13 · H2c-R28 · P22]", async () => {
    const f = await boundFlow();
    const a = await stored({ bind: f.bind });
    const del = await call(hub, "DELETE", `/conversations/${f.conv}`, { token });
    expect(del.status).toBeLessThan(300);
    const now = new Date(Date.now() + 1_000);
    const r = await sweep(now);
    expect(r.purged).toBeGreaterThanOrEqual(1);
    const row = await attRow(sql, a.id);
    expect(row).toBeDefined();
    expect(row.purged_at?.getTime()).toBe(now.getTime());
    expect(await exists(a.key)).toBe(false);
    for (const path of [`/attachments/${a.id}`, `/attachments/${a.id}/content`])
      expect({ path, status: (await call(hub, "GET", path, { token })).status }).toEqual({
        path,
        status: 404,
      });
  });

  it("HUB-FR-44 · A124 · hàng gắn purged_at (SQL) trong hội thoại còn → sau lượt quét vẫn còn hàng; E10 available:false; không vào A của run sau [L9 · H2c-R14 · R28]", async () => {
    const f = await boundFlow();
    const a = await stored({ bind: f.bind, purged: true });
    await sweep(new Date(Date.now() + 1_000));
    expect(await attRow(sql, a.id)).toBeDefined();
    const e10 = await call(hub, "GET", `/conversations/${f.conv}/flows`, { token });
    const q = ((e10.json?.items ?? []) as Json[])[0]?.preview?.question;
    expect(q?.attachments).toMatchObject([{ id: a.id, available: false }]);
    const s = await sendWith(hub, token, f.conv, "Tin sau A124", undefined, f.flow);
    s.close();
    expect(s.status).toBe(200);
    const [run] = await sql<{ ids: string[] }[]>`select attachment_ids as ids from hub.runs
      where id = ${runIdOf(s)}`;
    expect(run?.ids).toEqual([]);
  });
});

describe("A125–A129 · mồ côi, lô, khoá, lỗi xoá [H2c-R29 · PL2 · PL11 · PL13]", () => {
  it("HUB-FR-44 · A125 · .part −1 h −1 s → xoá; .part −59 min → giữ; file không hàng −2 h → xoá; file có hàng sống −2 h → giữ; file của hàng purged → xoá; .part −2 h có hàng sống → rename thành <key>, /content 200 [AC-13 · H2c-R29 · PL13]", async () => {
    const t = T.acme;
    const key = () => `${t}/${crypto.randomUUID()}`;
    const partOld = key();
    const partNew = key();
    const noRow = key();
    for (const [kk, suffix, ago] of [
      [partOld, ".part", HOUR + 1_000],
      [partNew, ".part", 59 * 60_000],
      [noRow, "", 2 * HOUR],
    ] as [string, string, number][]) {
      await writeStored(hub.dir, `${kk}${suffix}`, sample.pdf(64));
      await mtime(pathOf(hub.dir, `${kk}${suffix}`), ago);
    }
    const live = await stored();
    await mtime(pathOf(hub.dir, live.key), 2 * HOUR);
    const f = await boundFlow();
    const purged = await stored({ bind: f.bind, purged: true });
    await mtime(pathOf(hub.dir, purged.key), 2 * HOUR);
    const crash = await stored();
    const cp = pathOf(hub.dir, crash.key);
    await rm(cp);
    await writeFile(`${cp}.part`, sample.pdf(2048));
    await mtime(`${cp}.part`, 2 * HOUR);
    const r = await sweep(new Date());
    expect(r.orphans).toBeGreaterThanOrEqual(3);
    const files = await diskFiles(hub.dir);
    expect({
      partOld: files.includes(`${partOld}.part`),
      partNew: files.includes(`${partNew}.part`),
      noRow: files.includes(noRow),
      live: files.includes(live.key),
      purged: files.includes(purged.key),
      crashPart: files.includes(`${crash.key}.part`),
      crash: files.includes(crash.key),
    }).toEqual({
      partOld: false,
      partNew: true,
      noRow: false,
      live: true,
      purged: false,
      crashPart: false,
      crash: true,
    });
    const c = await call(hub, "GET", `/attachments/${crash.id}/content`, { token });
    expect(c.status).toBe(200);
  });

  it("HUB-FR-44 · A126 · hàng purged_at chưa gắn mà file đã mất (crash giả) → lượt sau DELETE hàng, không lỗi [PL2]", async () => {
    const a = await insertAttachmentRow(sql, { purged: true });
    const r = await sweep(new Date());
    expect(r.skipped).toBe(false);
    expect(await attRow(sql, a.id)).toBeUndefined();
  });

  it("HUB-FR-44 · A127 · lô 500: 501 hàng hết hạn → lượt 1 xoá 500, lượt 2 xoá 1; log info attachment-sweep{expired, purged, orphans, ms} chỉ khi > 0 [H2c-R27 · plan-errors §5]", async () => {
    await sql`delete from hub.attachments`;
    const u = USERS.lan;
    await sql`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256,
        storage_key, created_at)
      select g.id, ${u.tid}, ${u.id}, 'upload', 'x.pdf', 'x.pdf', 'application/pdf', 10, repeat('a', 64),
        ${u.tid}::text || '/' || g.id::text, now() - interval '25 hours'
      from (select gen_random_uuid() as id from generate_series(1, 501)) g`;
    const now = new Date();
    const r1 = await sweep(now);
    const r2 = await sweep(now);
    expect([r1.expired, r2.expired]).toEqual([500, 1]);
    const [left] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
    expect(left?.n).toBe(0);
    const lines = log.lines.filter((l) => l.rec.msg === "attachment-sweep");
    expect(lines.length).toBe(2);
    expect(lines[0]?.level).toBe("info");
    expect(Object.keys(lines[0]?.rec ?? {})).toEqual(
      expect.arrayContaining(["expired", "purged", "orphans", "ms"]),
    );
    const r3 = await sweep(now);
    expect(r3.expired).toBe(0);
    expect(log.lines.filter((l) => l.rec.msg === "attachment-sweep").length).toBe(2);
  });

  it("HUB-FR-44 · A128 · khoá toàn cục: khoá 'hub.attach.sweep' đang bị giữ → skipped:true, 0 việc, hàng còn; hai sweepOnce song song → tổng xoá = số hàng, mọi lượt skipped không làm gì, không lỗi [PL11]", async () => {
    await sql`delete from hub.attachments`;
    const ids = [];
    for (let i = 0; i < 20; i++)
      ids.push((await insertAttachmentRow(sql, { createdAgoMs: DAY_MS + 60_000 })).id);
    const held = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('hub.attach.sweep'))`;
      return sweep(new Date());
    });
    expect(held).toEqual({ expired: 0, purged: 0, orphans: 0, skipped: true });
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
    expect(n?.n).toBe(20);
    const rs = await Promise.all([sweep(new Date()), sweep(new Date())]);
    expect(rs.reduce((s, r) => s + r.expired, 0)).toBe(20);
    for (const r of rs.filter((x) => x.skipped))
      expect(r).toEqual({ expired: 0, purged: 0, orphans: 0, skipped: true });
    expect(rs.some((r) => !r.skipped)).toBe(true);
  });

  it("HUB-FR-44 · A129 · remove lỗi (Windows: file chỉ đọc; Linux: chmod thư mục tenant 0500) → warn attachment-remove-failed{attachment_id}; trả quyền → lượt sau dọn [H2c-R29 · P23]", async () => {
    const a = await stored({ createdAgoMs: DAY_MS + 60_000 });
    const target = WIN ? pathOf(hub.dir, a.key) : join(hub.dir, T.acme);
    await chmod(target, WIN ? 0o444 : 0o500);
    try {
      await sweep(new Date());
      const w = log.lines.filter((l) => l.rec.msg === "attachment-remove-failed");
      expect(w[0]?.level).toBe("warn");
      expect(w[0]?.rec).toMatchObject({ attachment_id: a.id });
    } finally {
      await chmod(target, WIN ? 0o644 : 0o700);
    }
    await sweep(new Date());
    expect({ row: !!(await attRow(sql, a.id)), file: await exists(a.key) }).toEqual({
      row: false,
      file: false,
    });
  });
});
