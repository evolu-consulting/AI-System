// CR-121 D-3: nút thêm bước CHỈ icon, theo `nodes` của khe (hover/tooltip hiện nhãn). Node form chưa dựng được (vd Dify cần chọn
// workflow) hiện mờ kèm lý do; node ngoài danh mục của khe không có nút.
import type { SlotNodeDto } from "@ai/contracts/hub-admin";
import { CheckCircle2, type LucideIcon, PenLine, Plus, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const ICONS: Record<string, LucideIcon> = {
  "check-circle": CheckCircle2,
  sparkles: Sparkles,
  signature: PenLine,
};
/** Node Form thêm được ngay (Dify cần workflow ⇒ thêm ở Sơ đồ canvas). */
const FORM_KINDS = new Set(["review", "esign"]);
export const DEFAULT_NODES: readonly SlotNodeDto[] = [
  { kind: "review", label: "Duyệt", icon: "check-circle" },
  { kind: "esign", label: "Ký số", icon: "signature" },
];

type Props = {
  nodes: readonly SlotNodeDto[] | undefined;
  full: boolean;
  hasEsign: boolean;
  onAdd: (kind: "review" | "esign") => void;
};

export function FlowAddNodes({ nodes, full, hasEsign, onAdd }: Props) {
  const { t } = useTranslation();
  const list = nodes && nodes.length > 0 ? nodes : DEFAULT_NODES;
  return (
    <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
      <legend className="sr-only">{t("process.admin.library.form.addNode")}</legend>
      {list.map((n) => {
        const supported = FORM_KINDS.has(n.kind);
        const off = full || !supported || (n.kind === "esign" && hasEsign);
        const label = supported
          ? t("process.admin.library.form.addNodeOf", { name: n.label })
          : t("process.admin.library.form.nodeCanvasOnly", { name: n.label });
        const Icon = ICONS[n.icon] ?? Plus;
        return (
          <Button
            key={n.kind}
            type="button"
            variant="outline"
            size="icon"
            disabled={off}
            aria-label={label}
            title={label}
            data-testid={`flow-add-${n.kind}`}
            onClick={() => supported && onAdd(n.kind as "review" | "esign")}
          >
            <Icon aria-hidden className="size-4" />
          </Button>
        );
      })}
    </fieldset>
  );
}
