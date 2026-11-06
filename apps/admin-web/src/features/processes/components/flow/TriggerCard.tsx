// CR-122 · U1 · FLOW2-FR-02/16: node "Bắt đầu khi" — luôn là node đầu của flow: chọn sự kiện app khai + điều kiện trên dữ kiện của sự kiện.
import type { FlowTrigger } from "@ai/contracts/hub-admin";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { eventsOfApp } from "../../lib/flow-def";
import { FactWhenEditor } from "./FactWhenEditor";

type Props = {
  app: string;
  trigger: FlowTrigger;
  readOnly: boolean;
  onEvent: (key: string) => void;
  onWhen: (w: FlowTrigger["when"] | null) => void;
  error?: string | undefined;
};

export function TriggerCard({ app, trigger, readOnly, onEvent, onWhen, error }: Props) {
  const { t } = useTranslation();
  const events = eventsOfApp(app);
  const ev = events.find((e) => e.key === trigger.event);
  return (
    <section
      className="space-y-3 rounded-md border border-border bg-card p-3"
      aria-label={t("process.admin.flow.trigger")}
      data-testid="flow-trigger"
    >
      <div className="grid grid-cols-[8rem_minmax(0,22rem)] items-center gap-2">
        <h3 className="flex items-center gap-2 text-body font-medium">
          <Play aria-hidden className="size-4 text-primary" />
          {t("process.admin.flow.trigger")}
        </h3>
        <Select value={trigger.event} disabled={readOnly} onValueChange={onEvent}>
          <SelectTrigger
            aria-label={t("process.admin.flow.event")}
            data-testid="flow-trigger-event"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {events.map((e) => (
              <SelectItem key={e.key} value={e.key}>
                {e.label}
              </SelectItem>
            ))}
            {ev ? null : <SelectItem value={trigger.event}>{trigger.event}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      {ev ? (
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-2">
          <span className="pt-2 text-caption text-muted-foreground">
            {t("process.admin.flow.onlyWhen")}
          </span>
          <FactWhenEditor
            id="trigger"
            when={trigger.when}
            facts={ev.facts}
            disabled={readOnly}
            onChange={onWhen}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
