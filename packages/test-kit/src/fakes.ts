// TK1 · transport giả dùng chung (gom từ N3 `transport.fake.ts`, HD2 `makeAi`). Kiểu cấu trúc tối thiểu — không import app.
// Mọi fake: ghi lại lời gọi, kịch bản theo khoá, `failNext` ném lỗi mạng một lần, `reset()`.

export type SendResult = { ok: true } | { ok: false; code: string; retryable?: boolean };
export type Script<K, R> = (key: K) => R | undefined;

/** Lô tin (email SMTP / web push): một lời gọi `sendBatch` mỗi lô; kịch bản theo khoá người nhận. */
export class FakeBatchTransport<M> {
  readonly sent: M[] = [];
  calls = 0;
  script: Script<string, SendResult> = () => undefined;
  failNext: Error | null = null;
  constructor(private readonly keyOf: (m: M) => string) {}

  async sendBatch(msgs: readonly M[]): Promise<SendResult[]> {
    this.calls++;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    return msgs.map((m) => {
      const forced = this.script(this.keyOf(m));
      if (forced) return forced;
      this.sent.push(m);
      return { ok: true } as const;
    });
  }
  reset(): void {
    this.sent.length = 0;
    this.calls = 0;
    this.script = () => undefined;
    this.failNext = null;
  }
}

export const fakeSmtp = <M extends { to: string }>(): FakeBatchTransport<M> =>
  new FakeBatchTransport<M>((m) => m.to);
export const fakeWebPush = <M extends { endpoint: string }>(): FakeBatchTransport<M> =>
  new FakeBatchTransport<M>((m) => m.endpoint);

export type AgentCall = { tenantId: string; contractId?: string; system?: string; prompt: string };
export type AgentResult =
  | { ok: true; text: string }
  | { ok: false; code: "AGENT_FAILED" | "TIMEOUT" };

/** Agent Claude giả tất định: kịch bản theo lượt gọi; mặc định `AGENT_FAILED`; `settled(key)` chờ bằng tín hiệu (không sleep). */
export class FakeAgent {
  readonly calls: AgentCall[] = [];
  script: (c: AgentCall) => AgentResult = () => ({ ok: false, code: "AGENT_FAILED" });
  private waiters = new Map<string, Array<(o: string) => void>>();

  readonly transport = async (c: AgentCall): Promise<AgentResult> => {
    this.calls.push(c);
    return this.script(c);
  };
  /** Promise resolve khi `signal(key, outcome)` — đăng ký TRƯỚC khi kích hoạt. */
  settled(key: string): Promise<string> {
    return new Promise((res) => this.waiters.set(key, [...(this.waiters.get(key) ?? []), res]));
  }
  readonly signal = (key: string, outcome: string): void => {
    const w = this.waiters.get(key) ?? [];
    this.waiters.delete(key);
    for (const f of w) f(outcome);
  };
  reset(): void {
    this.calls.length = 0;
    this.waiters.clear();
    this.script = () => ({ ok: false, code: "AGENT_FAILED" });
  }
}

export type TaxAnswer =
  | { result: "found"; name: string; status: string | null }
  | { result: "not_found" | "unavailable" | "invalid" };

/** Tra cứu MST giả: bảng đáp án theo mã; thiếu = `unavailable`. */
export class FakeTaxRegistry {
  readonly calls: string[] = [];
  answers: Record<string, TaxAnswer> = {};
  readonly lookup = async (taxId: string): Promise<TaxAnswer> => {
    this.calls.push(taxId);
    return this.answers[taxId] ?? { result: "unavailable" };
  };
  reset(): void {
    this.calls.length = 0;
    this.answers = {};
  }
}
