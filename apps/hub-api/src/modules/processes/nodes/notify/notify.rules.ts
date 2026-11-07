// CR-121 D-6 · node `notify` — luật THUẦN: kiểm def (NOTIFY_INVALID), dựng mẫu `{khoá-input}`, khoá chống gửi trùng, .md kết quả.
import {
  HANDOFF_SECTION,
  type NotifyExecutor,
  type ProcessDefInput,
} from "@ai/contracts/hub-admin";
import type { DefIssue } from "../types";

/** Mục kết quả của .md (Hub sinh); mục "Bàn giao" như stage chờ. */
export const NOTIFY_RESULT_SECTION = "Kết quả";
export const NOTIFY_STAGE_TEMPLATE = `# {name}\n\n## ${NOTIFY_RESULT_SECTION}\n\n## ${HANDOFF_SECTION}\n`;

/** Kind trên `hub.notifications`: chuông riêng / chuông + mail (vòng chia kênh bỏ mail của kind chỉ-chuông). */
export const NOTIFY_KIND_BELL = "process.notify";
export const NOTIFY_KIND_MAIL = "process.notify_mail";
export const notifyKindOf = (ex: Pick<NotifyExecutor, "channels">): string =>
  ex.channels.includes("email") ? NOTIFY_KIND_MAIL : NOTIFY_KIND_BELL;

/** Khoá chống gửi trùng (run, stage run, vòng, lần thử): retry/sweep chạy lại cùng vòng + lần thử không chèn thêm (UNIQUE dedup).
 *  CR-121 F-3 · có `round`: trả lại / chạy lại bước (`resetStage`) giữ id stage run, đặt `attempt = 1` nhưng tăng `round` ⇒ mỗi
 *  vòng gửi đúng một lần (thiếu `round` thì vòng 2+ bị ON CONFLICT nuốt). */
export const notifyDedupKey = (
  runId: string,
  stageRunId: string,
  round: number,
  attempt: number,
): string => `pn:${runId}:${stageRunId}:${round}:${attempt}`;

const VAR_RE = /\{([a-z][a-z0-9_-]{0,63})\}/g;
/** `{khoá}` ⇒ giá trị input run; khoá không có ⇒ rỗng. Cắt trần sau khi thay. */
export function renderNotify(tpl: string, inputs: Readonly<Record<string, string>>, max: number) {
  const out = tpl.replace(
    VAR_RE,
    (_, k: string) => (Object.hasOwn(inputs, k) ? inputs[k] : "") ?? "",
  );
  return out.trim().slice(0, max);
}

/**
 * CR-125 m9 · biến mẫu `{khoá}` = đầu ra các bước trước (theo thứ tự stage, bước sau đè) + input của lượt (input THẮNG khi trùng khoá —
 * giữ mẫu cũ). Chỉ giá trị chuỗi / số hữu hạn / đúng-sai.
 */
export function notifyVars(
  inputs: Readonly<Record<string, string>>,
  prior: readonly Readonly<Record<string, unknown>>[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of prior)
    for (const [k, v] of Object.entries(f)) {
      if (typeof v === "string") out[k] = v;
      else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean")
        out[k] = String(v);
    }
  return { ...out, ...inputs };
}

/** CR-125 m9 · đầu ra `sent_to` (Người nhận thông báo): tên người nhận; không ai ⇒ không có khoá. */
export const notifyFields = (names: string): Record<string, string> =>
  names.trim() ? { sent_to: names.trim().slice(0, 1000) } : {};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Người nhận đã tách: user id (người bắt đầu + user ở input) + mã Group. Id sai dạng bị bỏ (SQL còn lọc theo công ty của run). */
export function notifyTargets(
  ex: Pick<NotifyExecutor, "to">,
  starterId: string,
  inputs: Readonly<Record<string, string>>,
): { userIds: string[]; groupKeys: string[] } {
  const users = new Set<string>();
  const groups = new Set<string>();
  for (const t of ex.to) {
    if (t.who === "starter") users.add(starterId);
    else if (t.who === "group") groups.add(t.group_key);
    else {
      const v = inputs[t.input]?.trim() ?? "";
      if (UUID_RE.test(v)) users.add(v.toLowerCase());
    }
  }
  return { userIds: [...users], groupKeys: [...groups] };
}

/** .md của stage: số người nhận; rỗng ⇒ cảnh báo nói rõ vì sao (bước vẫn xong). `again` ⇒ lần chạy lại, đã ghi từ trước. */
export function notifyOutputMd(
  name: string,
  r: { recipients: number; inserted: number; title: string },
): string {
  const result =
    r.recipients === 0
      ? "Cảnh báo: không có người nhận — người bắt đầu/nhóm/người phụ trách không còn dùng được hoặc nhóm không có thành viên ở công ty này. Bước vẫn hoàn tất, không gửi gì."
      : r.inserted === 0
        ? `Đã ghi thông báo "${r.title}" cho ${r.recipients} người từ lần chạy trước (không gửi lại).`
        : `Đã gửi thông báo "${r.title}" tới ${r.recipients} người.`;
  return `# ${name}\n\n## ${NOTIFY_RESULT_SECTION}\n\n${result}\n\n## ${HANDOFF_SECTION}\n\n${result}\n`;
}

/** NOTIFY_INVALID: thiếu người nhận / kênh / tiêu đề; input người nhận không khai ở def. */
export function notifyDefIssues(d: ProcessDefInput): DefIssue[] {
  const inputs = new Set((d.inputs ?? []).map((i) => i.key));
  const out: DefIssue[] = [];
  d.stages.forEach((s, i) => {
    const ex = s.executor;
    if (ex.kind !== "notify") return;
    const add = (f: string) =>
      out.push({ path: `stages.${i}.executor.${f}`, rule: "NOTIFY_INVALID" });
    if (ex.to.length === 0) add("to");
    if (ex.to.some((t) => t.who === "input_user" && !inputs.has(t.input))) add("to");
    if (ex.channels.length === 0) add("channels");
    if (ex.title.trim() === "") add("title");
  });
  return out;
}

/** Hub ép trường khi lưu: template/mục cố định, không field, người trả lời = starter, không token. Thuần, idempotent. */
export function ensureNotifyStage<S extends ProcessDefInput["stages"][number]>(s: S): S {
  if (s.executor.kind !== "notify") return s;
  return {
    ...s,
    output: {
      filename: s.output.filename,
      template: NOTIFY_STAGE_TEMPLATE,
      required_sections: [NOTIFY_RESULT_SECTION, HANDOFF_SECTION],
      fields: [],
    },
    answerer: { kind: "starter" },
    token_budget: null,
  };
}
