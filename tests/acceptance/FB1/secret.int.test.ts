// HUB-FR-140 · HUB-BR-30 · FB1-AC-07 · FB1-AC-08 · scope CORE-ONLY: token FileBox lấy từ env `FILEBOX_TOKEN` (KHÔNG có hub.secrets / useSecret /
// scope platform). Giữ ý: thiếu token ⇒ fail-closed (500, FileBox 0 call) ở MỌI đường dùng FileBox (upload, link, bytes); token không vào
// log, response, job, run_steps, tin nhắn. Hàm `parseAttachEnv` thiếu `FILEBOX_TOKEN` ném lỗi chỉ nêu TÊN biến: xem `rules.test.ts` e4.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { captureLogs, type LogLine } from "../H2b/_h2b";
import { codeOf, sample, setupH2c, upload } from "../H2c/_h2c";
import { fileJob, internalGet } from "../H2c/_h2c2";
import {
  type FbFake,
  fakeTokens,
  type HubFb,
  insertFbRow,
  needFb,
  startFbFake,
  startHubFb,
} from "./_fb1";

let sql: Sql;
let k: Keys;
let fake: FbFake;
let hub: HubFb;
let lan = "";

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  fake = startFbFake();
  hub = await startHubFb(k, { fake });
  lan = await sign(k, USERS.lan);
}, 60_000);
beforeEach(async () => {
  fake.reset();
  await sql`delete from hub.attachments`;
});
afterAll(async () => {
  await hub?.stop();
  await fake?.close();
  await sql?.end();
});

const nav = (id: string, token: string, mode = "navigate") =>
  fetch(`${hub.base}/attachments/${id}/content`, {
    headers: { authorization: `Bearer ${token}`, "sec-fetch-mode": mode },
    redirect: "manual",
    keepalive: false,
  });

describe("FB1-AC-08 · thiếu FILEBOX_TOKEN ⇒ fail-closed mọi đường [HUB-FR-140]", () => {
  it("HUB-FR-140 · FB1-AC-08 · k1 · token vắng: upload 500 INTERNAL_ERROR; /content (navigate → link, cors → bytes) 500; FileBox 0 call; không rơi về đường không token", async () => {
    await needFb(sql);
    const row = await insertFbRow(sql, fake, sample.pdf(2048));
    const h = await startHubFb(k, {
      fake,
      tokens: fakeTokens(null),
      extra: { instanceId: "qc-hub-fb1-notoken2" },
    });
    try {
      await needFb(sql, h);
      expect(codeOf(await upload(h, lan, sample.pdf(1024), "khong-token.pdf"))).toEqual({
        status: 500,
        code: "INTERNAL_ERROR",
      });
      for (const mode of ["navigate", "cors"]) {
        const r = await fetch(`${h.base}/attachments/${row.id}/content`, {
          headers: { authorization: `Bearer ${lan}`, "sec-fetch-mode": mode },
          redirect: "manual",
          keepalive: false,
        });
        await r.arrayBuffer();
        expect({ mode, status: r.status }).toEqual({ mode, status: 500 });
      }
      expect(fake.calls).toEqual([]);
    } finally {
      await h.stop();
    }
  });
});

describe("FB1-AC-07 · token không lộ [HUB-FR-140 · HUB-BR-30]", () => {
  it("HUB-BR-30 · FB1-AC-07 · k2 · upload + 302 + bytes inline + CLI download: giá trị token không có trong response, log, hub.jobs, hub.run_steps, hub.messages", async () => {
    await needFb(sql, hub);
    const lines: LogLine[] = [];
    const cap: { lines: LogLine[]; restore: () => void } = captureLogs();
    const texts: string[] = [];
    try {
      const up = await upload(hub, lan, sample.pdf(2048), "khong-lo.pdf");
      expect(up.status).toBe(201);
      texts.push(up.text);
      const a = await nav(up.json.id, lan);
      texts.push(a.headers.get("location") ?? "", await a.text());
      const b = await nav(up.json.id, lan, "cors");
      expect(b.status).toBe(200);
      texts.push(await b.text());
      const j = await fileJob(sql, hub, {
        files: [{ name: "cli.pdf", content: sample.pdf(1500) }],
      });
      const f = j.files[0] as (typeof j.files)[number];
      const p = fake.put(f.content, f.id);
      await sql`update hub.attachments set filebox_file_id = ${p.file_id}, filebox_version_id = ${p.version_id} where id = ${f.id}`;
      const d = await internalGet(hub, j.jobId, f.id, j.token);
      expect(d.status).toBe(200);
    } finally {
      lines.push(...cap.lines);
      cap.restore();
    }
    const token = fake.token;
    expect(texts.join("\n")).not.toContain(token);
    expect(JSON.stringify(lines)).not.toContain(token);
    const [r] = await sql<{ n: number }[]>`select (
        (select count(*) from hub.jobs where payload::text like ${`%${token}%`})
      + (select count(*) from hub.run_steps where detail::text like ${`%${token}%`})
      + (select count(*) from hub.messages where content::text like ${`%${token}%`}))::int as n`;
    expect(r?.n).toBe(0);
  });
});
