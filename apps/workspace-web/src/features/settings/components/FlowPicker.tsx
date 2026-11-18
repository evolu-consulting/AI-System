// CR-184 · «Quy trình: [Tên ▾]» — ô chọn (Select của kit) thay danh sách thẻ; mỗi dòng: tên · số bước · «Bắt đầu khi …», đúng thứ tự xét.
import { Label } from "@ai/web-kit/ui/kit/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai/web-kit/ui/kit/select";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { CurrentFlow } from "../lib/current-flow";
import type { PartnerWarn } from "../lib/partner-warn";
import { whenText } from "../lib/start-when";
import { useWarnText } from "./PartnerWarn";

/** «Bắt đầu khi …» của một quy trình, bằng chữ nghiệp vụ. */
function startText(f: CurrentFlow, t: TFunction): string {
  return t("contracts.flow.current.startWhen", {
    when: f.startWhenBad
      ? t("contracts.flow.current.unreadable")
      : whenText(f.startWhen, f.groupNames, t),
  });
}

export function FlowPicker({
  flows,
  value,
  onChange,
  warns = {},
}: {
  flows: CurrentFlow[];
  value: string;
  onChange: (id: string) => void;
  /** CR-185 · quy trình (theo `defId`) thiếu điều kiện đối tác ⇒ dòng cảnh báo vàng trong ô chọn. */
  warns?: Record<string, PartnerWarn>;
}) {
  const { t } = useTranslation();
  const warnText = useWarnText();
  const cur = flows.find((f) => f.defId === value);
  return (
    <div className="mb-4 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <Label htmlFor="flow-select" className="shrink-0">
        {t("contracts.flow.current.pickLabel")}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="flow-select" data-testid="flow-select" className="sm:max-w-xl">
          <SelectValue>{cur?.name}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {flows.map((f, i) => (
            <SelectItem key={f.defId} value={f.defId} data-testid={`flow-option-${i}`}>
              <span className="flex flex-col">
                <span className="font-medium">
                  {f.name} · {t("contracts.flow.current.stepCount", { count: f.steps.length })}
                </span>
                <span className="text-caption text-dim" data-testid={`flow-when-${i}`}>
                  {startText(f, t)}
                </span>
                {warns[f.defId] ? (
                  <span
                    className="text-caption font-medium text-warning"
                    data-testid={`flow-warn-${i}`}
                  >
                    {`⚠ ${warnText(warns[f.defId] as PartnerWarn)}`}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
