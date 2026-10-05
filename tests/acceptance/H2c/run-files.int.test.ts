// HUB-FR-44 · H2c-R14 · test-plan-int §2.7 A56–A62: tập file của run `runs.attachment_ids` (chốt ở `createRunTx`) — tin hiện
// tại trước, rồi tin cũ hơn của cùng flow mới nhất trước, trong tin theo `position`; ≤ 10 file, dừng ở file làm tổng
// > 100 MiB (không nhảy cóc); bỏ `purged_at`, không lẫn flow khác; không đổi khi file bị xoá sau đó; run `command` chỉ file tin
// hiện tại; flow mới không ids → `'{}'`. File tin cũ gắn bằng SQL (hàng giả cỡ lớn không file — Q-T1).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { insertConv, insertFlow, runIdOf } from "../H1/_hub";
import { type Dify, startDify } from "../H2a/_h2a";
import { settleRuns } from "../H2b/_h2b";
import {
  type HubC,
  insertAttachmentRow,
  MAX,
  sendWith,
  setupH2c,
  startHubH2c,
  userMessages,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;
let token = "";

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2c(k);
  token = await sign(k, USERS.lan);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await sql?.end();
});

/** Flow có `n` tin user (cách nhau 1 s, cũ hơn 1 h) trong hội thoại mới; trả id tin theo thời gian tăng. */
async function flowWith(n: number): Promise<{ conv: string; flow: string; msgs: string[] }> {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
    msgs: Array.from({ length: n }, (_, i) => ({ role: "user" as const, content: `tin ${i + 1}` })),
  });
  return { conv, flow, msgs: (await userMessages(sql, flow)).map((m) => m.id) };
}
/** `count` file gắn vào `messageId` (position 0…), cỡ `size`. */
async function bindFiles(
  f: { conv: string; flow: string },
  messageId: string,
  count: number,
  o: { size?: number; purged?: boolean; from?: number } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await insertAttachmentRow(sql, {
      size: o.size ?? 2048,
      purged: o.purged,
      bind: { messageId, conversationId: f.conv, flowId: f.flow, position: (o.from ?? 0) + i },
    });
    ids.push(r.id);
  }
  return ids;
}
/** E12 vào flow có sẵn → `runs.attachment_ids` của run mới. */
async function runFiles(
  f: { conv: string; flow?: string },
  content: string,
  ids?: string[],
): Promise<{ status: number; runId: string; files: string[] }> {
  const s = await sendWith(hub, token, f.conv, content, ids, f.flow);
  s.close();
  const runId = runIdOf(s);
  const [r] = runId
    ? await sql<{ ids: string[] }[]>`select attachment_ids as ids from hub.runs where id = ${runId}`
    : [];
  return { status: s.status, runId, files: r?.ids ?? [] };
}

describe("A56–A62 · tập file của run [H2c-R14]", () => {
  it("HUB-FR-44 · A56 · tin 1 (2 file) → tin 2 cùng flow không file → runs.attachment_ids run 2 = file tin 1 theo position [H2c-R14]", async () => {
    const f = await flowWith(1);
    const files = await bindFiles(f, f.msgs[0] ?? "", 2);
    const r = await runFiles(f, "Tin 2 không file");
    expect(r.status).toBe(200);
    expect(r.files).toEqual(files);
  });

  it("HUB-FR-44 · A57 · tin 1 (a), tin 2 (b, c) → run 2 A = [b, c, a] (tin hiện tại trước) [H2c-R14]", async () => {
    const f = await flowWith(1);
    const a = (await bindFiles(f, f.msgs[0] ?? "", 1))[0] as string;
    const b = (await insertAttachmentRow(sql)).id;
    const c = (await insertAttachmentRow(sql)).id;
    const r = await runFiles(f, "Tin 2 có b, c", [b, c]);
    expect(r.status).toBe(200);
    expect(r.files).toEqual([b, c, a]);
  });

  it("HUB-FR-44 · A58 · 3 tin × 4 file → run sau A 10 phần tử, mới nhất trước (tin 3 [0..3], tin 2 [0..3], tin 1 [0, 1]) [H2c-R14 · T3]", async () => {
    const f = await flowWith(3);
    const per = [];
    for (const m of f.msgs) per.push(await bindFiles(f, m, 4));
    const r = await runFiles(f, "Tin 4 không file");
    expect(r.status).toBe(200);
    expect(r.files).toEqual([...(per[2] ?? []), ...(per[1] ?? []), ...(per[0] ?? []).slice(0, 2)]);
  });

  it("HUB-FR-44 · A59 · tổng > 100 MiB (hàng giả 20 MiB × 6) → 5 file đầu, dừng ở file thứ 6, không nhảy cóc sang file nhỏ sau đó [H2c-R14 · T3]", async () => {
    const f = await flowWith(2);
    const newer = await bindFiles(f, f.msgs[1] ?? "", 3, { size: MAX });
    const older = await bindFiles(f, f.msgs[0] ?? "", 3, { size: MAX });
    await bindFiles(f, f.msgs[0] ?? "", 1, { size: 1024, from: 3 });
    const r = await runFiles(f, "Tin 3 không file");
    expect(r.status).toBe(200);
    expect(r.files).toEqual([...newer, ...older.slice(0, 2)]);
  });

  it("HUB-FR-44 · A60 · file purged_at bị loại khỏi A; flow khác của cùng hội thoại không lẫn [H2c-R14]", async () => {
    const f = await flowWith(1);
    const live = await bindFiles(f, f.msgs[0] ?? "", 1);
    await bindFiles(f, f.msgs[0] ?? "", 1, { purged: true, from: 1 });
    const other = await insertFlow(sql, "lan", f.conv, crypto.randomUUID(), {
      msgs: [{ role: "user", content: "flow khác" }],
    });
    const [om] = await userMessages(sql, other);
    await bindFiles({ conv: f.conv, flow: other }, om?.id ?? "", 2);
    const r = await runFiles(f, "Tin 2");
    expect(r.status).toBe(200);
    expect(r.files).toEqual(live);
  });

  it("HUB-FR-44 · A61 · chốt lúc tạo run: sau khi run tạo, đặt purged_at cho file → runs.attachment_ids không đổi [H2c-R14 · P9]", async () => {
    const f = await flowWith(1);
    const files = await bindFiles(f, f.msgs[0] ?? "", 2);
    const r = await runFiles(f, "Tin 2 A61");
    expect(r.files).toEqual(files);
    await sql`update hub.attachments set purged_at = now() where id = any(${sql.array(files, 2950)})`;
    const [after] = await sql<{ ids: string[] }[]>`select attachment_ids as ids from hub.runs
      where id = ${r.runId}`;
    expect(after?.ids).toEqual(files);
  });

  it("HUB-FR-44 · A62 · run command /hoadon ở flow có file cũ → A = chỉ file tin hiện tại; flow mới không ids → attachment_ids '{}' [H2c-R14 · R20]", async () => {
    const f = await flowWith(1);
    await bindFiles(f, f.msgs[0] ?? "", 2);
    const cur = (await insertAttachmentRow(sql)).id;
    const r = await runFiles(f, "/hoadon ghi chú A62", [cur]);
    expect(r.status).toBe(200);
    expect(r.files).toEqual([cur]);
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const plain = await runFiles({ conv }, "Flow mới không file A62");
    expect(plain.status).toBe(200);
    expect(plain.files).toEqual([]);
  });
});
