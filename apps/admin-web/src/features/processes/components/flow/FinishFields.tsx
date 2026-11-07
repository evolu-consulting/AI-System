// CR-122 · U1 · FLOW2-FR-15: form của node "Kết thúc" — chọn kết quả app khai cho sự kiện; hiện câu "app sẽ làm gì".
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StageDraft } from "../../lib/draft-types";
import { useFlowCtx } from "./flow-ctx";

type Props = {
  stage: StageDraft;
  readOnly: boolean;
  onChange: (p: Partial<StageDraft>) => void;
  onRemove: () => void;
};

export function FinishFields({ stage, readOnly, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const outs = useFlowCtx()?.event?.outcomes ?? [];
  const cur = outs.find((o) => o.key === stage.outcome);
  return (
    <div className="space-y-3" data-testid="flow-finish">
      <div className="space-y-1">
        <Label htmlFor="finish-name">{t("process.admin.flow.finish.name")}</Label>
        <Input
          id="finish-name"
          value={stage.name}
          disabled={readOnly}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label>{t("process.admin.flow.finish.outcome")}</Label>
        <Select
          value={stage.outcome ?? ""}
          disabled={readOnly}
          onValueChange={(v) => onChange({ outcome: v })}
        >
          <SelectTrigger aria-label={t("process.admin.flow.finish.outcome")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {outs.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cur ? (
          <p className="text-caption text-muted-foreground" data-testid="finish-effect">
            {t("process.admin.flow.finish.effect", { effect: cur.effect })}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">
            {t("process.admin.flow.finish.pick")}
          </p>
        )}
      </div>
      {readOnly ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden className="size-4" />
          {t("process.admin.editor.remove")}
        </Button>
      )}
    </div>
  );
}
