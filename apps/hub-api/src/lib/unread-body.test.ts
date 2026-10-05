// HUB-FR-44 · spec-decisions "BUILD — B1" B1-3: lỗi trả trước khi đọc hết thân nhị phân ⇒ `Connection: close`; thân chunked
// còn dư ⇒ đọc bỏ (giới hạn) để kết nối dùng lại không đọc nhầm phần dư thành request kế.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { closeUnreadBody, drainBody, hasRequestBody, needsClose } from "./unread-body";

const MiB = 1_048_576;
const streamBody = (n: number, chunk = 256 * 1024) => {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= n) return c.close();
      const k = Math.min(chunk, n - sent);
      sent += k;
      c.enqueue(new Uint8Array(k));
    },
  });
};

describe("unread-body [B1-3]", () => {
  test("hasRequestBody / needsClose: chỉ lỗi ≥ 400, có thân, không JSON", () => {
    const req = (h: Record<string, string>) =>
      new Request("http://x/a", { method: "POST", headers: h });
    expect(hasRequestBody(req({ "content-length": "0" }))).toBe(false);
    expect(hasRequestBody(req({ "content-length": "5" }))).toBe(true);
    expect(hasRequestBody(req({ "transfer-encoding": "chunked" }))).toBe(true);
    expect(hasRequestBody(new Request("http://x/a"))).toBe(false);
    const bin = req({ "content-length": "5", "content-type": "application/pdf" });
    expect(needsClose(bin, 413)).toBe(true);
    expect(needsClose(bin, 201)).toBe(false);
    expect(
      needsClose(req({ "content-length": "5", "content-type": "application/json" }), 409),
    ).toBe(false);
  });

  test("drainBody: đọc hết → true; vượt maxBytes → false; stream đang khoá → false", async () => {
    expect(await drainBody(streamBody(MiB), { maxBytes: 2 * MiB, ms: 5_000 })).toBe(true);
    expect(await drainBody(streamBody(3 * MiB), { maxBytes: 2 * MiB, ms: 5_000 })).toBe(false);
    const locked = streamBody(10);
    locked.getReader();
    expect(await drainBody(locked, { maxBytes: 100, ms: 5_000 })).toBe(false);
    expect(await drainBody(null, { maxBytes: 100, ms: 5_000 })).toBe(false);
  });
});

describe("closeUnreadBody trên Bun.serve [B1-3]", () => {
  test("Bun.serve thật: 413 sớm cho upload chunked → kèm Connection: close; request kế trên client fetch vẫn 200", async () => {
    const app = new Hono();
    app.use(closeUnreadBody());
    app.post("/up", (c) => c.json({ e: 1 }, 413));
    app.get("/health", (c) => c.text("ok"));
    const server = Bun.serve({ port: 0, fetch: app.fetch });
    try {
      const base = `http://localhost:${server.port}`;
      const seen: (number | string | null)[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${base}/up`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: streamBody(4 * MiB),
        });
        seen.push(r.status, r.headers.get("connection"));
        await r.text();
        const g = await fetch(`${base}/health`);
        seen.push(g.status);
        await g.text();
      }
      expect(seen).toEqual([413, "close", 200, 413, "close", 200, 413, "close", 200]);
    } finally {
      server.stop(true);
    }
  });
});
