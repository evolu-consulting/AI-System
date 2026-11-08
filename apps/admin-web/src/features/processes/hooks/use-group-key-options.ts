// CR-123 u9 · Group của công ty theo KHOÁ (không phải id) cho ô "Gửi cho" của node Thông báo; gọi API ở hook (component không fetch).
import { isApproverGroup } from "@ai/contracts/groups";
import { useTranslation } from "react-i18next";
import { useGroupOptions } from "@/features/groups/api";
import { pickLocalized } from "@/lib/localized";
import type { Option } from "../components/editor/Fields";
import { useFlowCtx } from "../components/flow/flow-ctx";
import type { StageDraft } from "../lib/draft-types";
import type { EditorRefs } from "./use-editor-refs";
import { withCurrent } from "./use-editor-refs";

/** `approversOnly`: bỏ nhóm kỹ thuật (chọn làm người duyệt). Một mã một dòng (mẫu Thư viện nhìn nhóm của nhiều công ty). */
export function useGroupKeyOptions(
  tenantId: string | undefined,
  enabled: boolean,
  approversOnly = false,
): Option[] {
  const { i18n } = useTranslation();
  const groups = useGroupOptions(tenantId, enabled);
  const seen = new Set<string>();
  return (groups.data ?? [])
    .filter((g) => (!approversOnly || isApproverGroup(g)) && !seen.has(g.key) && !!seen.add(g.key))
    .map((g) => ({ value: g.key, label: pickLocalized(g.name, i18n.language) }));
}

/** Ô "Ai duyệt": mẫu Thư viện (platform sửa, không có công ty) chọn nhóm theo MÃ; flow công ty chọn theo id. */
export function useApproverField(stage: StageDraft, refs: EditorRefs, gone: string) {
  const flow = useFlowCtx();
  const lib = !!flow && !flow.tenantId;
  const keys = useGroupKeyOptions(undefined, lib, true);
  if (lib) {
    const v = stage.groupKey ?? "";
    return {
      value: v,
      options: withCurrent(keys, v, gone),
      patch: (k: string): Partial<StageDraft> => ({ groupKey: k, groupId: "" }),
    };
  }
  const opts = refs.approverGroups ?? refs.groups;
  return {
    value: stage.groupId,
    options: withCurrent(opts, stage.groupId, gone),
    patch: (id: string): Partial<StageDraft> => ({ groupId: id }),
  };
}
