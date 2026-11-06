// CR-122 · U2 · FLOW2-FR-15: khối sửa node Duyệt — chọn node đích khi Từ chối / Trả lại (thường là node Kết thúc tương ứng).
// Chỉ cho chọn bước đứng SAU bước của mình (luật `APPROVE_INVALID`); "Mặc định" = hành vi cổng cũ.
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StageFormProps } from "./stage-form-props";

const DEFAULT = "default";

export function StageApprove({ stage, all, readOnly, onChange }: StageFormProps) {
  const { t } = useTranslation();
  const cur = stage.approve ?? { reject: null, ret: null };
  const later = all.filter((s) => s.step > stage.step);
  const steps = [...new Set(later.map((s) => s.step))];
  const pick = (field: "reject" | "ret", label: string) => (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2">
      <Label>{label}</Label>
      <Select
        value={cur[field] === null ? DEFAULT : String(cur[field])}
        disabled={readOnly}
        onValueChange={(v) =>
          onChange({ approve: { ...cur, [field]: v === DEFAULT ? null : Number(v) } })
        }
      >
        <SelectTrigger aria-label={label} data-testid={`approve-${field}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{t("process.admin.flow.approve.default")}</SelectItem>
          {steps.map((st) => (
            <SelectItem key={st} value={String(st)}>
              {later
                .filter((s) => s.step === st)
                .map((s) => s.name || s.key)
                .join(" + ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="space-y-2" data-testid="stage-approve">
      {pick("reject", t("process.admin.flow.approve.reject"))}
      {pick("ret", t("process.admin.flow.approve.return"))}
    </div>
  );
}
