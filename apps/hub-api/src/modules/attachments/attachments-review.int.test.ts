// HUB-FR-44 · HUB-FR-75 · HUB-FR-50 · HUB-FR-12 · spec-decisions "REVIEW 2 — sửa Hub" RV2-1…RV2-3 (test cho RV-5, RV-7, RV-8
// của "REVIEW 1 — Hub"): ≤ 3 upload đồng thời/user ⇒ 429 `TOO_MANY_RUNS` + `Retry-After`, suất nhả sau lỗi (415/413) và sau
// khi xong; `GET /attachments/:id(/content)` uuid chữ hoa ⇒ 200; hàng đã `purged_at` trước upload Dify ⇒ MCP `isError`
// `NOT_ATTACHED` (0 lời gọi Dify), lệnh ⇒ `run.failed INTERNAL_ERROR` + log `attachment-unavailable`. Tín hiệu tất định:
// thân upload treo có kiểm soát + đếm `.part`; lệnh chặn ở INSERT `run_steps` (khoá bảng) tới khi đã dọn hàng.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { FILENAME_HEADER } from "@ai/contracts/chat";
import {
  call,
  type Keys,
  makeKeys,
  ownerSql,
  type Sql,
  sign,
  USERS,
  waitFor,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { insertConv, runIdOf } from "../../../../../tests/acceptance/H1/_hub";
import { type Dify, startDify } from "../../../../../tests/acceptance/H2a/_h2a";
import { toolCall } from "../../../../../tests/acceptance/H2a/_h2a2";
import { captureLogs, settleRuns } from "../../../../../tests/acceptance/H2b/_h2b";
import {
  type HubC,
  MiB,
  sample,
  sendWith,
  setupH2c,
  startHubH2c,
  tenantOf,
  uploadOk,
} from "../../../../../tests/acceptance/H2c/_h2c";
import {
  endSqlRuns,
  fileJob,
  storedFile,
  TOOL_FILE,
} from "../../../../../tests/acceptance/H2c/_h2c2";

// Helper H2c (`_h2c.ts`, `_h2c2.ts`) ép kiểu `BodyInit` của lib DOM (có ở `tsconfig.tests.json`, không ở hub-api) ⇒ bí danh
// sang kiểu tương đương của Bun để typecheck hub-api đi qua helper khoá mà không chép lại catalog H2c.
declare global {
  type BodyInit = Bun.BodyInit;
}

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;
let lan: string;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2c(k);
  lan = await sign(k, USERS.lan);
}, 60_000);
afterEach(async () => {
  await endSqlRuns(sql);
  await settleRuns(hub, sql, k);
});
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await sql?.end();
});

/** Upload `POST /attachments` thân stream treo: chunk đầu gửi ngay, phần còn lại do test đẩy (`push`/`end`). */
function held(token: string, name: string, head: Uint8Array) {
  let ctl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
      c.enqueue(head);
    },
  });
  const res = fetch(`${hub.base}/attachments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      [FILENAME_HEADER]: encodeURIComponent(name),
    },
    body,
    keepalive: false,
  });
  const c = () => ctl as unknown as ReadableStreamDefaultController<Uint8Array>;
  return {
    push: (b: Uint8Array) => c().enqueue(b),
    end: () => c().close(),
    done: async () => {
      const r = await res;
      return { status: r.status, json: (await r.json()) as { error?: { code: string } } };
    },
  };
}

const parts = async (): Promise<number> =>
  (await readdir(join(hub.dir, tenantOf("lan"))).catch(() => [] as string[])).filter((f) =>
    f.endsWith(".part"),
  ).length;
/** Chờ đúng `n` upload đang ghi `.part` (đã qua bộ đếm RV-5) — poll có hạn, không sleep cố định. */
async function partsAre(n: number): Promise<void> {
  expect(await waitFor(parts, (x) => x === n, 10_000)).toBe(n);
}

async function rejected429(): Promise<void> {
  const r = await fetch(`${hub.base}/attachments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${lan}`,
      "content-type": "application/octet-stream",
      [FILENAME_HEADER]: "x.pdf",
    },
    body: sample.pdf(512),
    keepalive: false,
  });
  const j = (await r.json()) as { error: { code: string } };
  expect({ status: r.status, code: j.error.code, retry: r.headers.get("retry-after") }).toEqual({
    status: 429,
    code: "TOO_MANY_RUNS",
    retry: "5",
  });
}

describe("RV2-1 · ≤ 3 upload đồng thời mỗi user [RV-5]", () => {
  it("HUB-FR-44 · thứ 4 ⇒ 429 TOO_MANY_RUNS + Retry-After 5 (user khác vẫn 201); suất nhả sau 415, 201, 413", async () => {
    const log = captureLogs();
    const h1 = held(lan, "a.txt", sample.txt(1024));
    const h2 = held(lan, "b.pdf", sample.pdf(1024));
    const h3 = held(lan, "c.pdf", sample.pdf(1024));
    try {
      await partsAre(3);
      await rejected429();
      expect(log.lines.some((l) => l.rec.msg === "attachment-rejected" && l.rec.code === 429)).toBe(
        true,
      );
      await uploadOk(hub, await sign(k, USERS.hoa), sample.pdf(512), "hoa.pdf");
      // Đóng thân ngay sau byte lỗi: route upload đọc bỏ phần dư (RV-4) — thân treo ⇒ chờ hạn đọc bỏ.
      h1.push(Uint8Array.of(0x61, 0, 0x61));
      h1.end();
      expect((await h1.done()).status).toBe(415);
      await uploadOk(hub, lan, sample.pdf(512), "sau-415.pdf");
      const h4 = held(lan, "d.pdf", sample.pdf(1024));
      await partsAre(3);
      await rejected429();
      h2.end();
      expect((await h2.done()).status).toBe(201);
      await uploadOk(hub, lan, sample.pdf(512), "sau-201.pdf");
      h3.push(new Uint8Array(21 * MiB));
      h3.end();
      expect((await h3.done()).status).toBe(413);
      await uploadOk(hub, lan, sample.pdf(512), "sau-413.pdf");
      h4.end();
      expect((await h4.done()).status).toBe(201);
    } finally {
      log.restore();
    }
  }, 30_000);
});

describe("RV2-2 · GET /attachments/:id uuid chữ hoa [RV-7]", () => {
  it("HUB-FR-75 · id chữ HOA ⇒ 200 (metadata id chữ thường; /content trả đúng byte)", async () => {
    const body = sample.pdf(700);
    const id = await uploadOk(hub, lan, body, "hoa-chu.pdf");
    const up = id.toUpperCase();
    const meta = await call(hub, "GET", `/attachments/${up}`, { token: lan });
    expect({ status: meta.status, id: meta.json?.id }).toEqual({ status: 200, id });
    const r = await fetch(`${hub.base}/attachments/${up}/content`, {
      headers: { authorization: `Bearer ${lan}` },
    });
    expect(r.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await r.arrayBuffer()), body)).toBe(0);
  });
});

const purge = (id: string) => sql`update hub.attachments set purged_at = now() where id = ${id}`;

describe("RV2-3 · MCP: hàng đã purged_at trước upload Dify [RV-8]", () => {
  it("HUB-FR-50 · MCP tools/call file đã dọn ⇒ isError NOT_ATTACHED (không -32603), 0 lời gọi Dify", async () => {
    const j = await fileJob(sql, hub, {
      tools: ["hoadon-file"],
      files: [{ name: "don.pdf", content: sample.pdf(900) }],
    });
    await purge(j.files[0]?.id ?? "");
    dify.mock.reset();
    const { res, result } = await toolCall(hub, j.token, "hoadon-file", { file: "don.pdf" });
    expect(res.json?.error).toBeUndefined();
    expect(result).toEqual({
      content: [{ type: "text", text: TOOL_FILE.notAttached }],
      isError: true,
    });
    expect(dify.mock.calls().length).toBe(0);
  });
});

describe("RV2-3 · lệnh: hàng đã purged_at trước upload Dify [RV-8]", () => {
  it("HUB-FR-12 · lệnh: hàng dọn sau khi tạo run, trước upload ⇒ run.failed INTERNAL_ERROR + log info attachment-unavailable", async () => {
    const f = await storedFile(sql, hub, "lenh-don.pdf", sample.pdf(900));
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    dify.mock.reset();
    const log = captureLogs();
    const lk = ownerSql();
    try {
      // Khoá `run_steps` (SHARE — chặn INSERT) ⇒ driver dừng ở `openStep`, sau R09/gắn file của E12, trước upload Dify.
      const sent = await lk.begin(async (tx) => {
        await tx`lock table hub.run_steps in share mode`;
        const s = sendWith(hub, lan, conv, "/hoadon ghi chú", [f.id]);
        const waiting = await waitFor(
          () =>
            sql<{ n: number }[]>`select count(*)::int as n from pg_locks
              where relation = 'hub.run_steps'::regclass and not granted`,
          (r) => (r[0]?.n ?? 0) > 0,
          10_000,
        );
        expect(waiting[0]?.n).toBeGreaterThan(0);
        await purge(f.id);
        return { s };
      });
      const s = await sent.s;
      expect(s.status).toBe(200);
      const end = await s.terminal(10_000);
      s.close();
      expect({ event: end?.event, code: end?.data?.code }).toEqual({
        event: "run.failed",
        code: "INTERNAL_ERROR",
      });
      const hit = log.lines.find(
        (l) => l.rec.msg === "attachment-unavailable" && l.rec.run_id === runIdOf(s),
      );
      expect({ level: hit?.level, id: hit?.rec.attachment_id }).toEqual({
        level: "info",
        id: f.id,
      });
      expect(dify.mock.calls().length).toBe(0);
    } finally {
      log.restore();
      await lk.end();
    }
  });
});
