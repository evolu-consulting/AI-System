// HUB-FR-44 · H2c-R11 · HUB-H2c-AC-06 · PL2 · test-plan-int §2.6 A53–A55: gắn file song song — 2 E12 cùng id → đúng 1 × 200,
// 1 × 404 AF (tin/run của bên thua không tồn tại); 10 E12 chồng lấn → mỗi id gắn ≤ 1 tin, không deadlock; sweeper chạy cùng
// lúc gắn → hoặc 404 AF, hoặc file gắn và **không** bị xoá (claim `purged_at` trước — PL2). 5 vòng (Q-T2).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sweepOnce } from "../../../apps/hub-api/src/modules/attachments/sweeper";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { insertConv, pgDeadlocks, runIdOf } from "../H1/_hub";
import { settleRuns } from "../H2b/_h2b";
import {
  attRow,
  codeOf,
  DAY_MS,
  diskFiles,
  expectAttachNotFound,
  expectStorage,
  type HubC,
  insertAttachmentRow,
  sample,
  sendWith,
  setupH2c,
  startHubH2c,
  userMessages,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
let token = "";

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k, { extra: { maxConcurrentRuns: 20 } });
  token = await sign(k, USERS.lan);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

type Sent = { status: number; json: unknown; runId: string; flowId: string };
async function post(content: string, ids: string[]): Promise<Sent> {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const s = await sendWith(hub, token, conv, content, ids);
  s.close();
  return {
    status: s.status,
    json: s.json,
    runId: runIdOf(s),
    flowId: s.headers.get("x-flow-id") ?? "",
  };
}
const fresh = (o: Parameters<typeof insertAttachmentRow>[1] = {}) =>
  insertAttachmentRow(sql, o).then((r) => r.id);
/** id tin user đầu của flow (rỗng nếu flow không tồn tại). */
const userMsg = async (flowId: string) =>
  flowId ? (await userMessages(sql, flowId))[0]?.id : undefined;

describe("A53–A55 · gắn song song [H2c-R11 · AC-06 · PL2]", () => {
  it("HUB-FR-44 · A53 · 2 POST song song (2 hội thoại của lan) cùng id → đúng 1 × 200, 1 × 404 AF; file gắn đúng tin của bên thắng; bên thua không có tin/run; 5 vòng [AC-06 · Q-T2]", async () => {
    for (let round = 0; round < 5; round++) {
      const id = await fresh();
      const rs = await Promise.all([post(`A53 v${round} a`, [id]), post(`A53 v${round} b`, [id])]);
      expect({ round, st: rs.map((r) => r.status).sort() }).toEqual({ round, st: [200, 404] });
      const win = rs.find((r) => r.status === 200) as Sent;
      const lose = rs.find((r) => r.status === 404) as Sent;
      expectAttachNotFound(lose, [id]);
      expect(lose.runId).toBe("");
      expect((await attRow(sql, id))?.message_id).toBe(await userMsg(win.flowId));
      await settleRuns(hub, sql, k);
    }
  });

  it("HUB-FR-44 · A54 · 10 POST song song, mỗi POST 3 id từ tập 5 id chồng lấn → POST 200 gắn đủ 3 id vào tin của nó, POST còn lại 404 AF; mỗi id gắn ≤ 1 tin; deadlocks không tăng [AC-06 · K6]", async () => {
    const d0 = await pgDeadlocks(sql);
    const pool = await Promise.all(Array.from({ length: 5 }, () => fresh()));
    const sets = Array.from({ length: 10 }, (_, i) =>
      [0, 1, 2].map((j) => pool[(i + j) % 5] as string),
    );
    const rs = await Promise.all(sets.map((ids, i) => post(`A54 ${i}`, ids)));
    const ok = rs.flatMap((r, i) => (r.status === 200 ? [{ r, ids: sets[i] as string[] }] : []));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of rs) expect([200, 404]).toContain(r.status);
    for (const r of rs.filter((x) => x.status === 404))
      expect(codeOf(r as never).code).toBe("ATTACHMENT_NOT_FOUND");
    const owner = new Map<string, string>();
    for (const { r, ids } of ok) {
      const msg = await userMsg(r.flowId);
      for (const id of ids) {
        expect(owner.has(id)).toBe(false);
        owner.set(id, msg ?? "");
        expect((await attRow(sql, id))?.message_id).toBe(msg);
      }
    }
    expect(await pgDeadlocks(sql)).toBe(d0);
  });

  it("HUB-FR-44 · A55 · sweepOnce (now = created_at + 24 h + 1 s) song song E12 với file sắp hết hạn → hoặc 404 AF, hoặc file gắn và nội dung còn (purged_at NULL); không bao giờ tin trỏ file mất nội dung; 5 vòng [PL2 · H2c-R11 · R27]", async () => {
    const storage = expectStorage(hub);
    for (let round = 0; round < 5; round++) {
      const ageMs = DAY_MS - 1_500;
      const { id, key } = await insertAttachmentRow(sql, {
        content: sample.pdf(2048),
        dir: hub.dir,
        createdAgoMs: ageMs,
      });
      const row = await attRow(sql, id);
      const now = new Date(row.created_at.getTime() + DAY_MS + 1_000);
      const [sent, swept] = await Promise.all([
        post(`A55 v${round}`, [id]),
        sweepOnce({ db: hub.db, storage, now }),
      ]);
      expect(swept.skipped).toBe(false);
      if (sent.status === 404) expectAttachNotFound(sent, [id]);
      else {
        expect(sent.status).toBe(200);
        const r = await attRow(sql, id);
        expect(r?.message_id).toBe(await userMsg(sent.flowId));
        expect(r?.purged_at).toBeNull();
        expect(await diskFiles(hub.dir)).toContain(key);
      }
      await settleRuns(hub, sql, k);
    }
  });
});
