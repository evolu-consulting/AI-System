// N3-FR-05 · N3-FR-06 · N3-FR-07 · N3-NFR-01 · N3-NFR-03 · MỘT lượt worker: chia kênh → nhận lô → gửi NGOÀI tx → ghi kết cục.
// Mỗi pha một tx và một câu SQL (số câu cố định, không theo số hàng); transport nhận cả lô (Luật 4c). Lỗi/ném của transport không
// làm hỏng lô: bản gửi đó thử lại theo backoff. Không sleep: người gọi (vòng nền) tự quyết ngủ khi `claimed = 0`.
import {
  BATCH_SIZE,
  type Claimed,
  emailOf,
  LEASE_SEC,
  MAX_ATTEMPTS,
  mergePush,
  pushOf,
  type SendResult,
  settle,
  TRANSPORT_TIMEOUT_MS,
  thrownResult,
} from "../domain/notify.rules";
import type { DispatchStore, EmailTransport, PushTransport, Settlement } from "./ports";

export type DispatchDeps = {
  store: DispatchStore;
  email: EmailTransport;
  push: PushTransport;
  now: () => Date;
  /** Gốc URL app để dựng liên kết tuyệt đối trong email. */
  baseUrl: string;
  batchSize?: number;
  leaseSec?: number;
  /** Hạn mỗi lời gọi transport (ms); phải < lease để lượt chậm không bị claim lại khi còn đang gửi. */
  transportTimeoutMs?: number;
};

export type DispatchResult = {
  fanned: number;
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
};

async function safeBatch<M>(
  send: (m: readonly M[]) => Promise<SendResult[]>,
  msgs: readonly M[],
  timeoutMs: number,
): Promise<SendResult[]> {
  if (msgs.length === 0) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Hạn cứng < lease: transport treo không giữ lô quá hạn thuê (M1). Hết hạn ⇒ cả lô thử lại.
    const out = await Promise.race([
      send(msgs),
      new Promise<never>((_, rej) => {
        timer = setTimeout(
          () => rej(Object.assign(new Error("timeout"), { name: "timeout" })),
          timeoutMs,
        );
      }),
    ]);
    // Transport trả thiếu ⇒ phần thiếu thử lại (không mất tin, không coi là đã gửi).
    return msgs.map((_, i) => out[i] ?? { ok: false, permanent: false, code: "transport_short" });
  } catch (err) {
    return msgs.map(() => thrownResult(err));
  } finally {
    clearTimeout(timer);
  }
}

type EmailOut = { delivery: Claimed; result: SendResult | null };

/** Bản gửi email không có địa chỉ ⇒ hỏng vĩnh viễn, không gọi transport. */
const noAddress: SendResult = { ok: false, permanent: true, code: "no_address" };

async function sendAll(d: DispatchDeps, rows: readonly Claimed[]) {
  const tmo = d.transportTimeoutMs ?? TRANSPORT_TIMEOUT_MS;
  const emails = rows.filter((r) => r.channel === "email");
  const pushes = rows.filter((r) => r.channel === "push");
  const sendable = emails.filter((r) => r.email !== "");
  const emailMsgs = sendable.map((r) => emailOf(r, d.baseUrl));
  const pushMsgs = pushes.flatMap((r) => pushOf(r));
  // Hai kênh song song; mỗi kênh MỘT lời gọi transport cho cả lô.
  const [er, pr] = await Promise.all([
    safeBatch((m) => d.email.sendBatch(m), emailMsgs, tmo),
    safeBatch((m) => d.push.sendBatch(m), pushMsgs, tmo),
  ]);
  const byEmail = new Map<string, SendResult>();
  sendable.forEach((r, i) => {
    byEmail.set(r.id, er[i] ?? noAddress);
  });
  const out: EmailOut[] = emails.map((r) => ({
    delivery: r,
    result: byEmail.get(r.id) ?? noAddress,
  }));
  const gone: string[] = [];
  let cursor = 0;
  const pushOut = pushes.map((r) => {
    const n = r.subs.length;
    const part = pr.slice(cursor, cursor + n);
    r.subs.forEach((s, i) => {
      if (part[i] && !part[i].ok && part[i].gone) gone.push(s.endpoint);
    });
    cursor += n;
    return { delivery: r, result: mergePush(part) };
  });
  return { results: [...out, ...pushOut] as { delivery: Claimed; result: SendResult }[], gone };
}

export async function dispatchOnce(d: DispatchDeps): Promise<DispatchResult> {
  const limit = d.batchSize ?? BATCH_SIZE;
  const lease = d.leaseSec ?? LEASE_SEC;
  const fan = await d.store.fanout(d.now().toISOString(), limit);
  const rows = await d.store.claim(d.now().toISOString(), limit, {
    leaseSec: lease,
    maxAttempts: MAX_ATTEMPTS,
  });
  const res: DispatchResult = {
    fanned: fan.picked,
    claimed: rows.length,
    sent: 0,
    retried: 0,
    dead: 0,
  };
  if (rows.length === 0) return res;
  const { results, gone } = await sendAll(d, rows);
  const nowMs = d.now().getTime();
  const settlements: Settlement[] = results.map(({ delivery, result }) => {
    const s = settle(delivery.attempts, result);
    if (s.outcome === "sent") res.sent++;
    else if (s.outcome === "retry") res.retried++;
    else res.dead++;
    return {
      id: delivery.id,
      attempts: delivery.attempts,
      outcome: s.outcome,
      error: s.outcome === "sent" ? null : s.error,
      nextAt: s.outcome === "retry" ? new Date(nowMs + s.delaySec * 1000).toISOString() : null,
    };
  });
  await d.store.settle(d.now().toISOString(), settlements, gone);
  return res;
}

/** Chạy tới khi hết việc (mỗi lượt ≤ `batchSize`); `maxRounds` chặn vòng vô hạn khi tin liên tục đổ vào. */
export async function drain(d: DispatchDeps, maxRounds = 20): Promise<DispatchResult> {
  const total: DispatchResult = { fanned: 0, claimed: 0, sent: 0, retried: 0, dead: 0 };
  for (let i = 0; i < maxRounds; i++) {
    const r = await dispatchOnce(d);
    total.fanned += r.fanned;
    total.claimed += r.claimed;
    total.sent += r.sent;
    total.retried += r.retried;
    total.dead += r.dead;
    if (r.fanned === 0 && r.claimed === 0) break;
  }
  return total;
}
