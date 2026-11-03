// CR-114 hub-fast-sdk · server Anthropic GIẢ cho test (Bun.serve, SSE Messages API): phát `text_delta` theo mẩu, mô phỏng
// prompt caching theo tiền tố (bỏ dấu `cache_control`): tiền tố tới mỗi breakpoint đã thấy ⇒ `cache_read`, phần mới tới
// breakpoint cuối ⇒ `cache_creation`, phần sau ⇒ `input`. Token ≈ ký tự/4. Chỉ dùng trong test.

type Block = { type: string; text?: string; cache_control?: unknown };
type Msg = { role: string; content: string | Block[] };
type Body = { model: string; system?: Block[]; messages: Msg[]; stream?: boolean };

const tok = (s: string): number => Math.ceil(s.length / 4);
const strip = (v: unknown): string =>
  JSON.stringify(v, (k, x) => (k === "cache_control" ? undefined : x));
const marked = (b: Block[] | string): boolean =>
  Array.isArray(b) && b.some((x) => x.cache_control !== undefined);

/** Ứng viên đọc cache: như API, tra lùi từ breakpoint qua từng ranh giới tin trước đó (tiền tố đã ghi ở lượt trước). */
function lookback(b: Body): string[] {
  const sys = b.system ?? [];
  const lastMarked = b.messages.findLastIndex((m) => marked(m.content));
  const out = sys.map((_, i) => strip({ s: sys.slice(0, i + 1) }));
  for (let i = 0; i <= lastMarked; i++) out.push(strip({ s: sys, m: b.messages.slice(0, i + 1) }));
  return out;
}

/** Tiền tố (chuỗi) tới từng breakpoint, theo thứ tự render system → messages. */
function breakpoints(b: Body): string[] {
  const out: string[] = [];
  const sys = b.system ?? [];
  sys.forEach((blk, i) => {
    if (blk.cache_control) out.push(strip({ s: sys.slice(0, i + 1) }));
  });
  b.messages.forEach((m, i) => {
    if (marked(m.content)) out.push(strip({ s: sys, m: b.messages.slice(0, i + 1) }));
  });
  return out;
}

export type FakeAnthropic = {
  url: string;
  calls: number;
  stop(): void;
};

export function startFakeAnthropic(o: { reply: string; chunk?: number }): FakeAnthropic {
  const cache = new Set<string>();
  const state = { calls: 0 };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (!new URL(req.url).pathname.startsWith("/v1/messages"))
        return new Response("not found", { status: 404 });
      state.calls += 1;
      const body = (await req.json()) as Body;
      const bps = breakpoints(body);
      const total = tok(strip({ s: body.system ?? [], m: body.messages }));
      const hit = lookback(body)
        .reverse()
        .find((p) => cache.has(p));
      const read = hit ? tok(hit) : 0;
      const last = bps.at(-1);
      const write = last ? Math.max(0, tok(last) - read) : 0;
      for (const p of bps) cache.add(p);
      const usage = {
        input_tokens: Math.max(0, total - read - write),
        output_tokens: 0,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: write,
      };
      const parts: string[] = [];
      const n = o.chunk ?? 8;
      for (let i = 0; i < o.reply.length; i += n) parts.push(o.reply.slice(i, i + n));
      const ev = (type: string, data: unknown) =>
        `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
      const msg = {
        id: `msg_${state.calls}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      };
      const chunks = [
        ev("message_start", { message: msg }),
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
        ...parts.map((t) =>
          ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }),
        ),
        ev("content_block_stop", { index: 0 }),
        ev("message_delta", {
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: tok(o.reply) },
        }),
        ev("message_stop", {}),
      ];
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(c) {
          for (const x of chunks) c.enqueue(enc.encode(x));
          c.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    get calls() {
      return state.calls;
    },
    stop: () => server.stop(true),
  };
}
