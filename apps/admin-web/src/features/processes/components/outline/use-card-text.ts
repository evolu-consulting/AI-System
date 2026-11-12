// CR-127 · UI-FLOW · chữ trên khối bước của sơ đồ soạn quy trình (mock Editor.dc): nhãn loại + TÊN NGƯỜI/PHÒNG (Duyệt, Ký số) hoặc điều kiện (Nếu)
// + một dòng phụ ("một người nhận việc · 48 giờ · ý kiến…"). Ngôn ngữ nghiệp vụ; tiền đọc được ("500 triệu").
import { useTranslation } from "react-i18next";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import type { StageDraft } from "../../lib/draft-types";
import { isMilestone, milestoneSummary } from "../../lib/milestone-panel";
import { constArgs, ESIGN_CODEC } from "../../lib/node-config";
import { kindOf, type NodeKind, summaryOf } from "../../lib/node-summary";
import type { Option } from "../editor/Fields";
import { OP_SYMBOL } from "../flow/FactWhenEditor";
import { useFlowCtx } from "../flow/flow-ctx";

type LooseT = (key: string, opts?: Record<string, unknown>) => string;
export type CardText = { kindId: NodeKind | "esign"; kind: string; title: string; summary: string };

const K = "process.admin.flow.outline.";
const labelOf = (list: readonly Option[], id: string): string | undefined =>
  list.find((o) => o.value === id)?.label;

/** Người / phòng duyệt của bước Duyệt (công ty: theo id; mẫu Thư viện không có tên ⇒ vắng). */
export function approverLabel(s: StageDraft, refs: EditorRefs): string | undefined {
  const uid = s.review?.approverUserId;
  if (uid) return labelOf(refs.users, uid);
  return s.groupId ? labelOf(refs.approverGroups ?? refs.groups, s.groupId) : undefined;
}

/** CR-139 · tiêu đề thẻ Duyệt: «trưởng phòng của người gửi» (kiểu mới) hoặc người / phòng đã chọn. */
const approveTitle = (s: StageDraft, refs: EditorRefs, word: (k: string) => string) =>
  s.review?.approverMode === "starter_head" ? word("starter_head") : approverLabel(s, refs);

/** Tên người ký công ty của cụm Ký số (cấu hình ở `args` của stage gửi ký); vắng ⇒ undefined. */
export function signerNames(cluster: readonly StageDraft[], refs: EditorRefs): string | undefined {
  for (const s of cluster) {
    const signers = ESIGN_CODEC.decode(constArgs(s.tool, ESIGN_CODEC.keys)).company_signers ?? [];
    const names = signers.flatMap((x) => {
      const n = labelOf(x.kind === "user" ? refs.users : refs.groups, x.id);
      return n ? [n] : [];
    });
    if (names.length > 0) return names.join(", ");
  }
  return undefined;
}

export function useCardText(refs: EditorRefs) {
  const { t } = useTranslation() as unknown as { t: LooseT };
  const flow = useFlowCtx();
  const facts = flow?.event?.facts ?? [];
  const labels = {
    fact: (k: string) => facts.find((f) => f.key === k)?.label ?? k,
    op: (o: string) => (OP_SYMBOL as Record<string, string>)[o] ?? o,
    step: (n: number) => flow?.stepName?.(n) ?? `${n + 1}`,
    word: (k: string, n?: number) =>
      k === "due"
        ? t(`${K}word.due`, { n })
        : t(
            `${K}word.${k === "evidence_opinion_plus" ? "evidence" : k.replace(/_(\w)/, (_, c: string) => c.toUpperCase())}`,
          ),
  };
  /** `cluster` = các stage của cụm Ký số (khối Ký số là MỘT khối). */
  return (s: StageDraft, cluster?: readonly StageDraft[]): CardText => {
    const name = s.name || s.key;
    if (cluster) {
      const who = signerNames(cluster, refs);
      return {
        kindId: "esign",
        kind: t("process.admin.flow.node.esign"),
        title: who ? t(`${K}signBy`, { names: who }) : t(`${K}esignSummary`),
        summary: "",
      };
    }
    if (isMilestone(s))
      return {
        kindId: "wait",
        kind: labels.word("milestone"),
        title: name,
        summary: milestoneSummary(s, approverLabel(s, refs), {
          owner: labels.word("owner"),
          due: (n) => labels.word("due", n),
        }),
      };
    const kindId = kindOf(s);
    const kind = t(`process.admin.flow.node.${kindId}`);
    const sum = summaryOf(s, labels);
    if (kindId === "approve" && !s.parallel)
      return { kindId, kind, title: approveTitle(s, refs, labels.word) ?? name, summary: sum };
    if (kindId === "if") return { kindId, kind, title: sum || name, summary: "" };
    return { kindId, kind, title: name, summary: sum };
  };
}
