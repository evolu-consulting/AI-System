// dlc-dify · luật thuần của queue DLC (MỖI project MỘT queue, FIFO): nhận việc, lấy việc kế (một việc `in_progress` tại một
// thời điểm ⇒ domain agent làm và merge tuần tự), ghi kết quả — đạt ⇒ `ready_to_deploy` (đã merge + test xanh, chờ người
// deploy); lỗi ⇒ quay lại ĐẦU queue cho dev agent làm lại (lùi bước) tới `MAX_ATTEMPTS`, quá ⇒ `failed`. Không I/O.

export const MAX_ATTEMPTS = 3;

export type QueueStatus = "queued" | "in_progress" | "ready_to_deploy" | "failed" | "cancelled";
export type QueueItem = {
  id: string;
  title: string;
  domain: string;
  detail: string;
  acceptance: string;
  status: QueueStatus;
  attempts: number;
  branch: string | null;
  notes: string[];
  source: string | null;
  updated_at: string;
};
export type NewItem = Pick<QueueItem, "id" | "title"> &
  Partial<Pick<QueueItem, "domain" | "detail" | "acceptance" | "source">>;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const safeId = (s: string) =>
  ID_RE.test(s)
    ? s
    : s
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "task";

/** Thêm việc vào cuối queue; id đã có (chưa xong) ⇒ bỏ qua. */
export function enqueue(q: QueueItem[], items: readonly NewItem[], now: string): QueueItem[] {
  const out = [...q];
  for (const it of items) {
    const id = safeId(it.id);
    if (out.some((x) => x.id === id && x.status !== "cancelled")) continue;
    out.push({
      id,
      title: it.title.slice(0, 200),
      domain: it.domain ?? "",
      detail: it.detail ?? "",
      acceptance: it.acceptance ?? "",
      status: "queued",
      attempts: 0,
      branch: null,
      notes: [],
      source: it.source ?? null,
      updated_at: now,
    });
  }
  return out;
}

/** Việc kế: đang có việc `in_progress` ⇒ trả lại chính nó (tuần tự); không ⇒ việc `queued` đầu tiên → `in_progress`. */
export function next(q: QueueItem[], now: string): { queue: QueueItem[]; item: QueueItem | null } {
  const busy = q.find((x) => x.status === "in_progress");
  if (busy) return { queue: q, item: busy };
  const i = q.findIndex((x) => x.status === "queued");
  if (i < 0) return { queue: q, item: null };
  const cur = q[i] as QueueItem;
  const item: QueueItem = {
    ...cur,
    status: "in_progress",
    branch: `task-${cur.id}`,
    updated_at: now,
  };
  const queue = [...q];
  queue[i] = item;
  return { queue, item };
}

/** Kết quả việc đang làm: đạt ⇒ ready_to_deploy; lỗi ⇒ về đầu queue (attempts+1) hoặc failed khi quá hạn. */
export function result(
  q: QueueItem[],
  id: string,
  outcome: { ok: boolean; note: string },
  now: string,
): { queue: QueueItem[]; item: QueueItem | null } {
  const { ok, note } = outcome;
  const i = q.findIndex((x) => x.id === id);
  if (i < 0) return { queue: q, item: null };
  const cur = q[i] as QueueItem;
  const notes = note ? [...cur.notes, note.slice(0, 4000)].slice(-10) : cur.notes;
  if (ok) {
    const item: QueueItem = { ...cur, status: "ready_to_deploy", notes, updated_at: now };
    const queue = [...q];
    queue[i] = item;
    return { queue, item };
  }
  const attempts = cur.attempts + 1;
  const status: QueueStatus = attempts >= MAX_ATTEMPTS ? "failed" : "queued";
  const item: QueueItem = { ...cur, status, attempts, notes, updated_at: now };
  if (status === "failed") {
    const queue = [...q];
    queue[i] = item;
    return { queue, item };
  }
  return { queue: [item, ...q.filter((_, k) => k !== i)], item };
}

export const summary = (q: readonly QueueItem[]) => {
  const by = (s: QueueStatus) => q.filter((x) => x.status === s).length;
  return {
    total: q.length,
    queued: by("queued"),
    in_progress: by("in_progress"),
    ready_to_deploy: by("ready_to_deploy"),
    failed: by("failed"),
  };
};
