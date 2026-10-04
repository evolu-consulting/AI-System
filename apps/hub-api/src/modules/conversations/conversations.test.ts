// HUB-FR-40 · HUB-FR-45 · luật thuần E5–E11: cursor, mẫu `q`, map run/message, bỏ khoá phạm vi trong query.
import { describe, expect, it } from "bun:test";
import { MessageSchema, RunSummarySchema } from "@ai/contracts/chat";
import { withoutScopeKeys } from "../../lib/http";
import {
  decodeCursor,
  encodeCursor,
  type MessageRow,
  type RunRow,
  stepLabel,
  takePage,
  titleSearchPattern,
  toMessage,
  toRunSummary,
} from "./conversations.rules";

const ID = "a1000000-0000-4000-8000-000000000201";
const AT = "2026-10-04T01:02:03.123456Z";

describe("HUB-FR-40 · cursor keyset", () => {
  it("HUB-FR-40 · encode → decode khứ hồi; rác / sai dạng / không chuẩn → null", () => {
    expect(decodeCursor(encodeCursor([AT, ID]))).toEqual([AT, ID]);
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    for (const raw of [
      "rac-khong-hop-le",
      b64([AT]),
      b64(["2026-10-04T01:02:03Z", ID]),
      b64([AT, "abc"]),
      b64({ at: AT, id: ID }),
      `${encodeCursor([AT, ID])}=`,
    ]) {
      expect(decodeCursor(raw)).toBeNull();
    }
  });

  it("HUB-FR-40 · takePage: dư một dòng → next = khoá dòng cuối trang; đủ → null", () => {
    const rows = [1, 2, 3].map((n) => ({ n, key: [AT, ID.replace(/1$/, String(n))] as const }));
    const p = takePage(rows, 2);
    expect(p.items.map((r) => r.n)).toEqual([1, 2]);
    expect(decodeCursor(p.next ?? "")).toEqual(rows[1]?.key ?? null);
    expect(takePage(rows, 3).next).toBeNull();
  });
});

describe("HUB-FR-40 · q không dấu", () => {
  it("HUB-FR-40 · mẫu LIKE đã foldVi, thoát % _ \\", () => {
    expect(titleSearchPattern(" HOÁ ĐƠN ")).toBe("%hoa don%");
    expect(titleSearchPattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });

  it("H1-R03 · query bỏ tenant_id/user_id, giữ khoá khác", () => {
    expect(withoutScopeKeys({ tenant_id: "x", user_id: "y", q: "a", limit: "2" })).toEqual({
      q: "a",
      limit: "2",
    });
  });
});

const run = (o: Partial<RunRow> = {}): RunRow => ({
  id: ID,
  status: "finished",
  locale: "vi",
  startedAt: new Date("2026-10-04T00:00:00.000Z"),
  finishedAt: new Date("2026-10-04T00:00:07.800Z"),
  errorCode: null,
  errorMessage: null,
  errorHint: null,
  ...o,
});
const step = (seq: number, type: "orchestrator" | "delegate", status: string) => ({
  runId: ID,
  seq,
  type,
  status,
  startedAt: new Date("2026-10-04T00:00:00.000Z"),
  finishedAt: new Date("2026-10-04T00:00:01.000Z"),
});

describe("HUB-FR-45 · tóm tắt run của tin assistant", () => {
  it("HUB-FR-45 · finished: ms, step ok/failed theo seq, bỏ running/skipped, nhãn theo locale", () => {
    const s = toRunSummary(run({ locale: "en" }), [
      step(2, "delegate", "failed"),
      step(1, "orchestrator", "ok"),
      step(3, "delegate", "skipped"),
      step(4, "delegate", "running"),
    ]);
    expect(RunSummarySchema.parse(s)).toEqual({
      id: ID,
      status: "finished",
      ms: 7800,
      steps: [
        { step_id: "s1", label: stepLabel("orchestrator", "en"), status: "ok", ms: 1000 },
        { step_id: "s2", label: "Working on it…", status: "failed", ms: 1000 },
      ],
      error: null,
    });
  });

  it("HUB-FR-45 · failed có lỗi; running → null", () => {
    const s = toRunSummary(
      run({ status: "failed", errorCode: "UPSTREAM_ERROR", errorMessage: "Lỗi", errorHint: null }),
      [],
    );
    expect(s?.error).toEqual({ code: "UPSTREAM_ERROR", message: "Lỗi", hint: "" });
    expect(toRunSummary(run({ status: "running", finishedAt: null }), [])).toBeNull();
  });

  it("HUB-FR-45 · toMessage: user không run/ask; ask jsonb sai dạng → null", () => {
    const base: MessageRow = {
      id: ID,
      conversationId: ID,
      flowId: ID,
      role: "user",
      content: "Xin chào",
      runId: null,
      ask: { question: "?" },
      createdAt: new Date(0),
    };
    const sum = toRunSummary(run(), []);
    expect(MessageSchema.parse(toMessage(base, sum))).toMatchObject({ run: null, ask: null });
    const a = toMessage(
      { ...base, role: "assistant", runId: ID, ask: { question: "Chọn?", choices: ["A"] } },
      sum,
    );
    expect(MessageSchema.parse(a).ask).toEqual({ question: "Chọn?", choices: ["A"] });
    expect(toMessage({ ...base, role: "assistant", ask: { question: 1 } }, null).ask).toBeNull();
  });
});
