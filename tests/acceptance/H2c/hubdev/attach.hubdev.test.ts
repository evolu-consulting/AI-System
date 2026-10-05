// HUB-FR-44 · HUB-H2c-AC-01 · test-plan cases §3 H01: hub-dev THẬT (`tools/hub-dev`, env `HUB_ATTACH_*` thư mục tạm mỗi lần
// — MK) — `lan` đăng nhập qua auth thật (`AUTH_URL`), `POST /attachments` `.txt` 10 B → 201; tạo hội thoại, gửi tin
// `#fake:files` kèm id → SSE `run.finished` (Runtime `fake` của hub-dev) hoặc, khi `HUB_DEV_RUNTIME=none`, chỉ cần 200 SSE
// có `run.started`; `GET /attachments/:id/content` đúng byte.
// Chạy: bước H01 H2c của `bun run done:h2c` (`needsDev`, `HUB_URL`/`AUTH_URL`, `bunfig.stack.toml`).
import { describe, expect, it } from "bun:test";
import {
  AttachmentSchema,
  ConversationSchema,
  createSseParser,
  FILENAME_HEADER,
} from "@ai/contracts/chat";
import {
  AUTH_URL as DEV_AUTH_URL,
  HUB_URL as DEV_HUB_URL,
} from "../../../../tools/hub-dev/src/dev";
import { CONTRACT_USERS, DEV_PASSWORD } from "../../../../tools/hub-dev/src/fixture";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến của bước hub-dev (`done:h2c`), không thuộc task turbo
const HUB = (process.env.HUB_URL?.trim() || DEV_HUB_URL).replace(/\/+$/, "");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến của bước hub-dev (`done:h2c`), không thuộc task turbo
const AUTH = (process.env.AUTH_URL?.trim() || DEV_AUTH_URL).replace(/\/+$/, "");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: hub-dev không bật Runtime (docs/guides/hub-dev.md)
const NO_RUNTIME = process.env.HUB_DEV_RUNTIME === "none";
const BYTES = new TextEncoder().encode("xin chao\n\n"); // 10 B

async function tokenOf(): Promise<string> {
  const u = CONTRACT_USERS.a;
  const res = await fetch(`${AUTH}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_key: u.tenant_key,
      username: u.username,
      password: DEV_PASSWORD,
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { status?: string; access_token?: string };
  expect(body.status).toBe("authenticated");
  return String(body.access_token);
}

/** SSE tới khi gặp `stopAt` (hoặc server đóng / hết `ms`) → tên sự kiện đã thấy. */
async function sseEvents(res: Response, stopAt: string[], ms: number): Promise<string[]> {
  const seen: string[] = [];
  const reader = res.body?.getReader();
  if (!reader) return seen;
  const feed = createSseParser((frame) => seen.push(frame.event));
  const deadline = Date.now() + ms;
  const dec = new TextDecoder();
  while (Date.now() < deadline && !seen.some((e) => stopAt.includes(e))) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(dec.decode(value, { stream: true }));
  }
  await reader.cancel().catch(() => {});
  return seen;
}

describe("H01 · hub-dev tải file + gửi tin có file [HUB-H2c-AC-01]", () => {
  it("HUB-FR-44 · H01 · lan POST /attachments .txt 10 B → 201; gửi '#fake:files' + id → SSE run.finished (hoặc run.started khi HUB_DEV_RUNTIME=none); /content đúng byte [HUB-H2c-AC-01]", async () => {
    const token = await tokenOf();
    const auth = { authorization: `Bearer ${token}` };
    const upRes = await fetch(`${HUB}/attachments`, {
      method: "POST",
      headers: {
        ...auth,
        [FILENAME_HEADER]: "h01.txt",
        "content-type": "application/octet-stream",
      },
      body: BYTES,
    });
    expect(upRes.status).toBe(201);
    const att = AttachmentSchema.parse(await upRes.json());
    const convRes = await fetch(`${HUB}/conversations`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: "H01 H2c" }),
    });
    expect(convRes.status).toBe(201);
    const conv = ConversationSchema.parse(await convRes.json());
    const send = await fetch(`${HUB}/conversations/${conv.id}/messages`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ content: "@assistant #fake:files H01", attachment_ids: [att.id] }),
    });
    expect(send.status).toBe(200);
    const want = NO_RUNTIME ? ["run.started"] : ["run.finished", "run.failed"];
    const seen = await sseEvents(send, want, 60_000);
    expect(seen).toContain(NO_RUNTIME ? "run.started" : "run.finished");
    const content = await fetch(`${HUB}/attachments/${att.id}/content`, { headers: auth });
    expect(content.status).toBe(200);
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(BYTES);
  }, 90_000);
});
