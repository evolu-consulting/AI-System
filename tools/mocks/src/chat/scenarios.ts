// CHAT-AC-05..16, 24–28 · kịch bản tất định của mock chat (plan C1 §3.2, §3.3). Thuần: không I/O, không đồng hồ.
// `buildScript` trả chuỗi nhịp; engine (`runs.ts`) gắn `id`, chờ, và điền `message_id`/`content` cho sự kiện kết thúc
// (tin assistant chỉ có id khi run kết thúc nên nhịp kết thúc là `finish`/`fail`, không phải `ChatEvent` đủ).
import {
  type AskData,
  CHAT_SCN_PREFIX,
  type ChatRunErrorCode,
  type DeltaData,
  type RunStartedData,
  type StepFinishedData,
  type StepStartedData,
} from "@ai/contracts/chat";

export const SCENARIO_NAMES = [
  "normal",
  "markdown",
  "steps",
  "ask",
  "slow",
  "err-exhausted",
  "err-timeout",
  "err-upstream",
  "drop",
  "flow-cold",
  "quota-warn",
  "quota-over",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export type FailData = { ms: number; code: ChatRunErrorCode; message: string; hint: string };
export type ScriptEvent =
  | { event: "run.started"; data: RunStartedData }
  | { event: "step.started"; data: StepStartedData }
  | { event: "step.finished"; data: StepFinishedData }
  | { event: "delta"; data: DeltaData }
  | { event: "ask"; data: AskData }
  /** → `run.finished{run_id, message_id, content = nối delta, ms}` */
  | { event: "finish"; data: { ms: number } }
  /** → `run.failed{run_id, message_id, code, message, hint}` */
  | { event: "fail"; data: FailData };
/** Chờ `waitMs` rồi phát `event`. `fastMs` = thời gian chờ riêng ở `MOCK_FAST` (thay cho ÷10). */
export type Beat = { waitMs: number; fastMs?: number; event: ScriptEvent };
/** `messageCount` = số tin của flow kể cả tin vừa gửi (C1-R02). */
export type ScriptCtx = { runId: string; flowId: string; messageCount: number };

export function isScenarioName(v: string): v is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(v);
}

/** Q-scn: tiền tố `#scn:<tên hợp lệ>` → flow nghỉ ⇒ `flow-cold` → mặc định toàn cục → `normal`. */
export function pickScenario(i: {
  content: string;
  fallback: ScenarioName | null;
  flowIdle: boolean;
}): ScenarioName {
  const head = i.content.trimStart();
  if (head.startsWith(CHAT_SCN_PREFIX)) {
    const name = head.slice(CHAT_SCN_PREFIX.length).split(/\s/, 1)[0] ?? "";
    if (isScenarioName(name)) return name;
  }
  if (i.flowIdle) return "flow-cold";
  return i.fallback ?? "normal";
}

/** Thời gian chờ thật: `fast` → `fastMs` nếu có, không thì `max(1, round(waitMs/10))`; 0 giữ 0. */
export function realWait(b: Beat, fast: boolean): number {
  if (b.waitMs === 0 || !fast) return b.waitMs;
  return b.fastMs ?? Math.max(1, Math.round(b.waitMs / 10));
}

/** `drop`: E12 đóng ngay sau delta thứ 5 (plan §3.3, K-R4). */
export const DROP_AFTER_DELTAS = 5;
export const CANCELLED_ERROR = { message: "Bạn đã dừng yêu cầu này.", hint: "" } as const;
const ERRORS: Record<"err-exhausted" | "err-timeout" | "err-upstream", Omit<FailData, "ms">> = {
  "err-exhausted": {
    code: "ALL_PROVIDERS_EXHAUSTED",
    message: "Tất cả dịch vụ AI đang quá tải nên chưa trả lời được.",
    hint: "Thử lại sau ít phút.",
  },
  "err-timeout": {
    code: "TIMEOUT",
    message: "Hệ thống phản hồi quá lâu nên yêu cầu đã dừng.",
    hint: "Thử lại sau ít phút.",
  },
  "err-upstream": {
    code: "UPSTREAM_ERROR",
    message: "Dịch vụ AI trả lỗi khi xử lý yêu cầu.",
    hint: "Thử lại; nếu vẫn lỗi, báo quản trị viên.",
  },
};

type Quota = RunStartedData["quota"];
const QUOTA_OK: Quota = { state: "ok", pct: 12 };
const DELTA_MS = 40;

const NORMAL_BODY =
  "Chào bạn, đây là câu trả lời mẫu của trợ lý. Nội dung được phát dần từng từ để giao diện hiển thị luồng chữ.";
const flowLine = (n: number) => `Flow này có ${n} tin nhắn.`;
const EMAIL =
  "Kính gửi anh Phát, em gửi báo giá đơn hàng tháng mười như đã trao đổi ạ. Trân trọng, Minh.";
const SLOW_SENTENCE = "Báo cáo dài được viết từng phần để thử dừng.";
const MARKDOWN = [
  "## Báo cáo nhanh",
  "",
  "- Doanh thu tăng **12%**",
  "- Chi phí giữ nguyên",
  "",
  "| Hạng mục | Giá trị |",
  "|---|---|",
  "| Doanh thu | 1,2 tỷ |",
  "| Chi phí | 800 triệu |",
  "",
  "```ts",
  "const loiNhuan = 1200 - 800;",
  "```",
  "",
];
export const ASK_DATA: AskData = {
  question: "Bạn muốn tóm tắt cuộc họp nào?",
  choices: ["Họp giao ban sáng nay", "Họp khách hàng Minh Phát"],
};

/** Tách theo từ, giữ khoảng trắng đứng sau từ (nối lại = nguyên văn). */
export const words = (text: string): string[] => text.split(/(?<= )/);

function started(ctx: ScriptCtx, quota: Quota = QUOTA_OK, wait?: [number, number]): Beat {
  const data = { run_id: ctx.runId, flow_id: ctx.flowId, quota };
  const event = { event: "run.started", data } as const;
  return wait ? { waitMs: wait[0], fastMs: wait[1], event } : { waitMs: 0, event };
}

function deltas(texts: string[], waitMs: number, fastMs?: number): Beat[] {
  return texts.map((text) => {
    const event = { event: "delta", data: { text } } as const;
    return fastMs === undefined ? { waitMs, event } : { waitMs, fastMs, event };
  });
}

const finish = (ms: number): Beat => ({ waitMs: 0, event: { event: "finish", data: { ms } } });

/** `normal` và các biến thể: 30 delta (40 ms), dòng cuối "Flow này có n tin nhắn.". */
function answer(ctx: ScriptCtx, first: Beat, waitMs = DELTA_MS): Beat[] {
  const parts = words(`${NORMAL_BODY}\n\n${flowLine(ctx.messageCount)}`);
  return [first, ...deltas(parts, waitMs), finish(parts.length * waitMs)];
}

function steps(ctx: ScriptCtx): Beat[] {
  const step = (step_id: string, label: string) =>
    ({ waitMs: 0, event: { event: "step.started", data: { step_id, label } } }) as const;
  const done = (step_id: string, ms: number): Beat => ({
    waitMs: ms,
    event: { event: "step.finished", data: { step_id, status: "ok", ms } },
  });
  return [
    started(ctx),
    step("s1", "Hiểu yêu cầu"),
    done("s1", 2100),
    step("s2", "Đang viết email"),
    done("s2", 5700),
    ...deltas(words(EMAIL), DELTA_MS),
    finish(7800),
  ];
}

function failing(ctx: ScriptCtx, err: Omit<FailData, "ms">): Beat[] {
  const step_id = "s1";
  const label = "Đang xử lý yêu cầu";
  return [
    started(ctx),
    { waitMs: 100, event: { event: "step.started", data: { step_id, label } } },
    {
      waitMs: 1500,
      event: { event: "step.finished", data: { step_id, status: "failed", ms: 1500 } },
    },
    { waitMs: 0, event: { event: "fail", data: { ms: 1600, ...err } } },
  ];
}

function slow(ctx: ScriptCtx): Beat[] {
  const parts = words(Array(6).fill(SLOW_SENTENCE).join(" "));
  return [started(ctx), ...deltas(parts, 250, 100), finish(parts.length * 250)];
}

function markdown(ctx: ScriptCtx): Beat[] {
  const parts = [...MARKDOWN, flowLine(ctx.messageCount)].map((l, i, a) =>
    i < a.length - 1 ? `${l}\n` : l,
  );
  return [started(ctx), ...deltas(parts, DELTA_MS), finish(parts.length * DELTA_MS)];
}

/** Chuỗi nhịp của kịch bản (plan §3.3). `ms` của `step.finished`/`finish` là hằng (không theo `fast`). */
export function buildScript(name: ScenarioName, ctx: ScriptCtx): Beat[] {
  switch (name) {
    case "steps":
      return steps(ctx);
    case "ask":
      return [started(ctx), { waitMs: 300, event: { event: "ask", data: ASK_DATA } }, finish(300)];
    case "slow":
      return slow(ctx);
    case "markdown":
      return markdown(ctx);
    case "err-exhausted":
    case "err-timeout":
    case "err-upstream":
      return failing(ctx, ERRORS[name]);
    case "drop":
      return answer(ctx, started(ctx), 100);
    case "flow-cold":
      return answer(ctx, started(ctx, QUOTA_OK, [3000, 1000]));
    case "quota-warn":
      return answer(ctx, started(ctx, { state: "warn", pct: 85 }));
    case "quota-over":
      return answer(ctx, started(ctx, { state: "over", pct: 104 }));
    default:
      return answer(ctx, started(ctx));
  }
}
