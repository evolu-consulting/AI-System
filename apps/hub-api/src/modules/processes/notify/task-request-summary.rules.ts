// CR-126 · «Việc của tôi» · điều người duyệt đang duyệt: đối tác/NCC + số tiền + tên yêu cầu lấy từ phiếu của lượt (inputs + ô phiếu
// trong snapshot). Thuần; đọc cùng hàng đã join của `/me/review-tasks` (không truy vấn thêm).
import type { ReviewTaskListItem } from "@ai/contracts/chat";
import { startFormOf } from "@ai/contracts/hub-admin";
import { requestFields } from "../triggers/manual-request.service";

type Summary = NonNullable<ReviewTaskListItem["process_run"]["request"]>;
const PARTNER_RE = /(partner|supplier|vendor|customer|ncc|doi_?tac|khach)/i;
const PARTNER_LABEL_RE = /(đối tác|nhà cung cấp|ncc|khách hàng|nhà thầu)/i;

/** Tiền = ô kiểu `money` đầu tiên; đối tác = ô text khoá/nhãn nói về đối tác/NCC; thiếu phần nào ⇒ null phần đó. */
export function requestSummary(
  stage0: unknown,
  inputs: unknown,
  parentStage0?: unknown,
  parentInputs?: unknown,
): Summary {
  const parse = (s: unknown) => startFormOf(typeof s === "string" ? JSON.parse(s) : s);
  if (!parse(stage0) && parse(parentStage0)) return requestSummary(parentStage0, parentInputs);
  const cfg = parse(stage0);
  const list = (Array.isArray(inputs) ? inputs : []) as { key?: string; text?: string }[];
  const title = list.find((x) => x.key === "request_title")?.text?.trim() || null;
  if (!cfg) return { title, partner: null, amount: null };
  const fields = requestFields(cfg, inputs);
  const money = fields.find((f) => f.type === "money")?.value;
  const partner = fields.find(
    (f) => f.type === "text" && (PARTNER_RE.test(f.key) || PARTNER_LABEL_RE.test(f.label)),
  )?.value;
  return { title, partner: partner?.trim() || null, amount: money?.trim() || null };
}
