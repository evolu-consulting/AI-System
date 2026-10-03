// CHAT-AC-09, 16, 19, 20, 24–27 · dữ liệu mẫu của `minh` (plan C1 §3.5), thời điểm tương đối `now` lúc khởi động / reset.
// User khác (`lan`, `hoa`, `an`) rỗng — bộ test contract tự tạo dữ liệu.
import type { RunError, RunSummary, StepSummary } from "@ai/contracts/chat";
import type { ChatStore, ConvRec, FlowRec, Owner } from "./store";
import { findUser } from "./users";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Turn =
  | { role: "user"; ago: number; content: string }
  | { role: "assistant"; ago: number; content: string; run: Omit<RunSummary, "id"> };
type SeedConv = { title: string; flows: Turn[][] };

const ok = (step_id: string, label: string, ms: number): StepSummary => ({
  step_id,
  label,
  status: "ok",
  ms,
});
const done = (ms: number, steps: StepSummary[] = []) =>
  ({ status: "finished", ms, steps, error: null }) as const;
const TIMEOUT: RunError = {
  code: "TIMEOUT",
  message: "Hệ thống phản hồi quá lâu nên yêu cầu đã dừng.",
  hint: "Thử lại sau ít phút.",
};

const userSays = (ago: number, content: string): Turn => ({ role: "user", ago, content });
const aiSays = (ago: number, content: string, run: Omit<RunSummary, "id"> = done(1200)): Turn => ({
  role: "assistant",
  ago,
  content,
  run,
});

/** Thứ tự = `updated_at` giảm (K-C9). Mọi flow có `last_active_at` = tin cuối. */
export const MINH_SEED: readonly SeedConv[] = [
  {
    title: "Soạn email báo giá Minh Phát",
    flows: [
      [
        userSays(40 * MIN, "Soạn email báo giá 200 bộ bàn ghế văn phòng gửi công ty Minh Phát"),
        aiSays(
          40 * MIN - 8000,
          "Kính gửi Quý công ty Minh Phát,\n\nChúng tôi xin gửi báo giá 200 bộ bàn ghế văn phòng như sau…",
          done(7800, [ok("s1", "Hiểu yêu cầu", 2100), ok("s2", "Đang viết email", 5700)]),
        ),
      ],
      [
        userSays(10 * MIN, "Thêm điều khoản giao hàng trong 14 ngày"),
        aiSays(10 * MIN - 3000, "Đã thêm: Thời gian giao hàng trong vòng 14 ngày kể từ ngày ký."),
        userSays(3 * MIN, "Viết ngắn gọn hơn"),
        aiSays(2 * MIN, "Bản rút gọn: báo giá 200 bộ bàn ghế, giao trong 14 ngày."),
      ],
    ],
  },
  {
    title: "Hoá đơn tháng 9 cần đối chiếu",
    flows: [
      [
        userSays(3 * DAY + 2 * MIN, "Đối chiếu hoá đơn tháng 9 với sổ chi"),
        aiSays(3 * DAY, "Có 3 hoá đơn tháng 9 chưa khớp với sổ chi."),
      ],
    ],
  },
  {
    title: "Tóm tắt họp giao ban",
    flows: [
      [
        userSays(20 * DAY + MIN, "Tóm tắt biên bản họp giao ban sáng thứ Hai"),
        aiSays(20 * DAY, "", {
          status: "failed",
          ms: 30_000,
          steps: [{ step_id: "s1", label: "Đang xử lý yêu cầu", status: "failed", ms: 30_000 }],
          error: TIMEOUT,
        }),
      ],
    ],
  },
  {
    title: "Kế hoạch marketing Q3",
    flows: [
      [
        userSays(60 * DAY + MIN, "Lập kế hoạch marketing quý 3"),
        aiSays(60 * DAY, "Kế hoạch Q3 gồm 3 mũi: nội dung, quảng cáo, sự kiện."),
      ],
    ],
  },
];

function seedFlow(store: ChatStore, conv: ConvRec, turns: Turn[], now: number): void {
  let flow: FlowRec | null = null;
  for (const t of turns) {
    const at = now - t.ago;
    if (t.role === "user" && !flow) flow = store.startFlow(conv, t.content, at).flow;
    else if (t.role === "user" && flow) store.addUserMessage(flow, t.content, at);
    else if (t.role === "assistant" && flow) {
      const runId = crypto.randomUUID();
      const run = { id: runId, ...t.run };
      store.addAssistantMessage(flow, { content: t.content, runId, run, ask: null }, at);
    }
  }
}

/** Nạp seed của `minh` vào store (gọi lúc tạo mock và sau `/__mock/reset`). */
export function seedChat(store: ChatStore, now = Date.now()): void {
  const minh = findUser("acme", "minh");
  if (!minh) return;
  const owner: Owner = { userId: minh.id, tenantId: minh.tenant.id };
  for (const s of MINH_SEED) {
    const first = s.flows[0]?.[0];
    const conv = store.createConversation(owner, s.title, now - (first?.ago ?? 0));
    for (const turns of s.flows) seedFlow(store, conv, turns, now);
  }
}
