// CR-118 · cr118-app-config · luật thuần của sơ đồ + bảng bước CHỈ ĐỌC trong tab "Quy trình" của app: từ `slot_body` của quy trình thư viện
// (danh sách bước tuần tự của khe `contracts.approval`) dựng các dòng để hiển thị. Không React / không API.
import type { LibStep } from "@/features/processes/lib/flow-form";
import { parseSlotBody } from "@/features/processes/lib/flow-form";
import { describeWhen } from "@/features/processes/lib/library-list";

export type StepWho =
  | { type: "group"; key: string | null; headOnly: boolean }
  | { type: "owner" | "dept_head" | "user" }
  | { type: "workflow"; key: string }
  /** CR-121 D-6b · Thông báo (người nhận: người gửi / phụ trách / mã phòng) · Chờ tới (tự chạy tiếp tới giờ hẹn). */
  | { type: "notify"; creator: boolean; owner: boolean; group: string | null }
  | { type: "wait" };

export type StepRow = {
  key: string;
  index: number;
  name: string;
  kind: LibStep["kind"];
  who: StepWho;
  /** Hạn (giờ) + nhắc (giờ, null = không nhắc); bước tự động (Dify) không có. */
  timing: { dueH: number; remindH: number | null } | null;
  /** "Chỉ khi giá trị > 500 tr…" hoặc null = chạy mọi hợp đồng. */
  condition: string | null;
};

function whoOf(s: LibStep): StepWho {
  if (s.kind === "review")
    return { type: "group", key: s.department_group_key, headOnly: s.head_only };
  if (s.kind === "esign") return { type: s.company_signer.mode };
  if (s.kind === "notify")
    return { type: "notify", creator: s.to.creator, owner: s.to.owner, group: s.to.group_key };
  if (s.kind === "wait_until") return { type: "wait" };
  return { type: "workflow", key: s.workflow_key };
}

export function stepRows(steps: readonly LibStep[]): StepRow[] {
  return steps.map((s, i) => ({
    key: s.key,
    index: i + 1,
    name: s.name,
    kind: s.kind,
    who: whoOf(s),
    timing:
      s.kind === "dify" || s.kind === "notify" || s.kind === "wait_until"
        ? null
        : { dueH: s.due_h, remindH: s.remind_every_h },
    condition: s.kind === "review" ? describeWhen(s.when) : null,
  }));
}

/** `slot_body` của def thư viện ⇒ dòng bước; khe/nội dung không phải dạng bước tuần tự ⇒ null (UI nói "mở trình soạn"). */
export function rowsFromSlotBody(body: unknown): StepRow[] | null {
  const steps = parseSlotBody(body);
  return steps ? stepRows(steps) : null;
}
