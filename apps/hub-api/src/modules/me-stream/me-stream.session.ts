// HUB-FR-99 · HUB-BR-22 · X2a-AC08 · X2a-AC12 · phiên `/me/stream` (X2a plan §7, D11–D14; spec-isolation §1): quyết định
// nối lại (`Last-Event-ID` → tail/replay/`stream.reset`) TRƯỚC khi trả response (sự kiện XADD sau khi client nhận header
// luôn có id > điểm bắt đầu ⇒ không mất), replay rồi theo dõi, `: ping` mỗi `pingMs` kèm `accountUsable` (bị khoá ⇒ đóng),
// đóng lúc JWT `exp`, ≤ `USER_STREAM_CONN_MAX` phiên/user/instance (phiên mới đẩy phiên cũ nhất ra). Replay xếp theo khúc:
// chỉ `enqueue` khi hàng đợi còn chỗ, đầy ⇒ chờ client đọc (`pull`) — lô lớn không giết client nhanh (review-2 N4). Luồng live:
// hàng đợi vượt `bufferBytes` ⇒ đóng (phần đã xếp vẫn giao), client nối lại bằng `Last-Event-ID` (review RV1 #12).
import { SSE_PING_FRAME, USER_STREAM_CONN_MAX } from "@ai/contracts/chat";
import type { AuthUser } from "../../lib/auth.middleware";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { compareStreamId } from "../runner/runner.rules";
import { evictOldest, parseStreamId, resumeDecision } from "./me-stream.rules";
import type { UserEntry, UserStreamReader } from "./user-stream-reader";

const ENC = new TextEncoder();
const RESET_FRAME = "event: stream.reset\ndata: {}\n\n";
/** Trần hàng đợi byte mỗi phiên (mặc định) — vượt ⇒ đóng phiên, client nối lại bằng `Last-Event-ID`. */
export const ME_STREAM_BUFFER_BYTES = 1_048_576;
/** `setTimeout` tối đa (~24,8 ngày); token sống lâu hơn thì hẹn lại theo nhịp này. */
const MAX_TIMER_MS = 2_147_483_647;

type Ctl = ReadableStreamDefaultController<Uint8Array>;
type Closable = { end(): void };

export const userEntryFrame = (e: UserEntry): string =>
  `id: ${e.id}\nevent: ${e.ev.event}\ndata: ${JSON.stringify(e.ev.data)}\n\n`;

/** Phiên đang mở theo user trên instance này (giới hạn plan §7). */
export class MeStreamConns {
  readonly #by = new Map<string, Closable[]>();

  add(userId: string, s: Closable): void {
    const list = [...(this.#by.get(userId) ?? []), s];
    this.#by.set(userId, list);
    for (const old of evictOldest(list, USER_STREAM_CONN_MAX)) old.end();
  }

  remove(userId: string, s: Closable): void {
    const list = (this.#by.get(userId) ?? []).filter((x) => x !== s);
    if (list.length > 0) this.#by.set(userId, list);
    else this.#by.delete(userId);
  }

  count(userId: string): number {
    return this.#by.get(userId)?.length ?? 0;
  }
}

export type MeStreamDeps = {
  reader: UserStreamReader;
  conns: MeStreamConns;
  log: Logger;
  pingMs: number;
  /** Tắt instance ⇒ đóng stream, client tự nối lại instance khác. */
  signal?: AbortSignal;
  /** Trần hàng đợi byte của phiên (vắng ⇒ `ME_STREAM_BUFFER_BYTES`). */
  bufferBytes?: number;
};

/** Điểm bắt đầu của phiên: `reset` ⇒ phát `stream.reset` trước; `replay` ⇒ XRANGE `> from` trước khi theo dõi. */
export type ResumePlan = { reset: boolean; replay: boolean; from: string };

/** Bảng `Last-Event-ID` plan §7. Header rỗng = vắng; sai định dạng ⇒ reset. */
export async function resumePlan(
  reader: Pick<UserStreamReader, "info" | "lastId">,
  userId: string,
  raw: string | undefined,
): Promise<ResumePlan> {
  const id = parseStreamId(raw);
  const malformed = raw !== undefined && raw !== "" && id === null;
  const decision = malformed ? "reset" : resumeDecision(id, id ? await reader.info(userId) : null);
  if (decision === "replay" && id) return { reset: false, replay: true, from: id };
  return { reset: decision === "reset", replay: false, from: await reader.lastId(userId) };
}

export type MeStreamOpen = {
  user: AuthUser;
  plan: ResumePlan;
  /** Tài khoản còn dùng được (cache cấu hình); false ⇒ đóng ở nhịp ping kế. */
  usable: () => Promise<boolean>;
};

class MeStreamSession implements Closable {
  #last: string;
  #closed = false;
  #unsub = () => {};
  #ping: ReturnType<typeof setInterval> | undefined;
  #expiry: ReturnType<typeof setTimeout> | undefined;
  /** Đang replay: tràn hàng đợi không đóng phiên (đã tự chờ `pull`). */
  #replaying = false;
  /** Replay đang chờ client đọc bớt; `pulled()`/`stop()` gọi để chạy tiếp. */
  #drain: (() => void) | undefined;
  /**
   * Tắt instance: đóng ở lượt event loop SAU — Bun 1.3 treo `server.stop(true)` khi ≥ 2 stream bị `close()` cùng tick
   * ngay trước nó (đo thật, plan §16 B7); `stop(true)` cắt kết nối trước, `end()` sau đó vô hại.
   */
  readonly #onAbort = () => {
    setTimeout(() => this.end(), 0);
  };

  constructor(
    private readonly d: MeStreamDeps,
    private readonly o: MeStreamOpen,
    private readonly ctl: Ctl,
  ) {
    this.#last = o.plan.from;
  }

  async start(): Promise<void> {
    const { d, o } = this;
    if (d.signal?.aborted) return this.end();
    d.signal?.addEventListener("abort", this.#onAbort, { once: true });
    d.conns.add(o.user.userId, this);
    if (this.#closed) return;
    if (o.plan.reset) this.#send(RESET_FRAME);
    // byte đầu ngay khi mở: client đổi phase sang `open` theo byte đầu, không đợi `pingMs`
    this.#send(SSE_PING_FRAME);
    this.#ping = setInterval(() => this.#tick(), d.pingMs);
    this.#armExpiry();
    try {
      if (o.plan.replay) await this.#replay(await d.reader.range(o.user.userId, o.plan.from));
      if (this.#closed) return;
      this.#unsub = d.reader.subscribe(o.user.userId, this.#last, (e) => this.#push(e));
    } catch (err) {
      if (this.#closed) return;
      this.stop();
      this.ctl.error(err);
    }
  }

  /** `pull` của stream: hàng đợi còn chỗ ⇒ replay chạy tiếp. */
  pulled(): void {
    const go = this.#drain;
    this.#drain = undefined;
    go?.();
  }

  stop(): void {
    this.#closed = true;
    this.pulled();
    clearInterval(this.#ping);
    clearTimeout(this.#expiry);
    this.#unsub();
    this.d.conns.remove(this.o.user.userId, this);
    this.d.signal?.removeEventListener("abort", this.#onAbort);
  }

  end(): void {
    if (this.#closed) return;
    this.stop();
    try {
      this.ctl.close();
    } catch {
      // client đã huỷ
    }
  }

  /** D14: đóng đúng lúc `exp` (vắng `exp` ⇒ không hẹn; `accountUsable` vẫn kiểm mỗi ping). */
  #armExpiry(): void {
    const exp = this.o.user.exp;
    if (exp === undefined) return;
    const ms = exp * 1000 - Date.now();
    if (ms <= 0) {
      this.end();
      return;
    }
    this.#expiry = setTimeout(() => this.#armExpiry(), Math.min(ms, MAX_TIMER_MS));
  }

  #tick(): void {
    if (this.#closed) return;
    this.#send(SSE_PING_FRAME);
    this.o
      .usable()
      .then((ok) => {
        if (!ok) this.end();
      })
      .catch((err) => this.d.log.warn("me-stream-usable-failed", safeErrorFields(err)));
  }

  /** Replay theo khúc: mỗi frame chỉ xếp khi `desiredSize > 0` ⇒ hàng đợi vượt trần tối đa một frame. */
  async #replay(entries: UserEntry[]): Promise<void> {
    this.#replaying = true;
    for (const e of entries) {
      while (!this.#closed && (this.ctl.desiredSize ?? 0) <= 0) {
        await new Promise<void>((go) => {
          this.#drain = go;
        });
      }
      if (this.#closed) return;
      this.#push([e]);
    }
    this.#replaying = false;
  }

  #push(entries: UserEntry[]): void {
    for (const e of entries) {
      if (this.#closed || compareStreamId(e.id, this.#last) <= 0) continue;
      this.#last = e.id;
      this.#send(userEntryFrame(e));
    }
  }

  #send(frame: string): void {
    if (this.#closed) return;
    try {
      this.ctl.enqueue(ENC.encode(frame));
    } catch {
      this.stop();
      return;
    }
    if (!this.#replaying && (this.ctl.desiredSize ?? 0) < 0) {
      this.d.log.warn("me-stream-slow-client", { queued_over: -(this.ctl.desiredSize ?? 0) });
      this.end();
    }
  }
}

/** Stream SSE của một phiên (`plan` đã tính trước bằng `resumePlan`). Client ngắt ⇒ huỷ đăng ký, rời giới hạn. */
export function meEventStream(d: MeStreamDeps, o: MeStreamOpen): ReadableStream<Uint8Array> {
  let session: MeStreamSession | undefined;
  return new ReadableStream<Uint8Array>(
    {
      start(ctl) {
        session = new MeStreamSession(d, o, ctl);
        // không trả promise: `pull` chỉ được gọi sau khi `start` xong, mà replay chờ `pull` (lỗi đã xử lý trong `start()`)
        void session.start();
      },
      pull() {
        session?.pulled();
      },
      cancel() {
        session?.stop();
      },
    },
    { highWaterMark: d.bufferBytes ?? ME_STREAM_BUFFER_BYTES, size: (c) => c?.byteLength ?? 0 },
  );
}
