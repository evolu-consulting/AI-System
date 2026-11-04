// CR-118 · cr118-app-config · sơ đồ + bảng bước CHỈ ĐỌC của quy trình mặc định của khe (Bắt đầu → các bước → Ghi Đã duyệt, nút hệ thống khoá).
// Sửa luôn ở ProcessEditorPage ("Xem sơ đồ" / "Nhân bản để sửa" ở thẻ khe). Chuyển (không import chéo app) từ ý tưởng FlowCanvas/FlowCurrentPane của contracts-web.
import { ArrowRight, Flag, Lock, Play } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSlotFlow } from "../hooks/use-slot-flow";
import type { StepRow, StepWho } from "../lib/flow-view";

function useWho() {
  const { t } = useTranslation();
  return (w: StepWho): string => {
    switch (w.type) {
      case "group":
        return w.key
          ? `${w.key}${w.headOnly ? ` · ${t("appcfg.flow.headOnly")}` : ""}`
          : t("appcfg.flow.noGroup");
      case "workflow":
        return t("appcfg.flow.workflow", { key: w.key });
      default:
        return t(`appcfg.flow.signer.${w.type}`);
    }
  };
}

function Pill({ icon: Icon, children }: { icon: typeof Play; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-caption font-medium">
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}

function Diagram({ rows }: { rows: StepRow[] }) {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t("appcfg.flow.diagram")}
      data-testid="slot-flow-diagram"
      className="flex flex-wrap items-center gap-2"
    >
      <li>
        <Pill icon={Play}>{t("appcfg.flow.start")}</Pill>
      </li>
      {rows.map((r) => (
        <Fragment key={r.key}>
          <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
          <li className="rounded-lg border border-border bg-card px-3 py-1.5 text-caption">
            <span className="font-semibold">{`${r.index}. ${r.name}`}</span>
            <span className="ml-2 inline-flex gap-1">
              <StatusBadge tone="info">{t(`appcfg.flow.kind.${r.kind}`)}</StatusBadge>
              {r.condition ? (
                <StatusBadge tone="warn">{t("appcfg.flow.conditional")}</StatusBadge>
              ) : null}
            </span>
          </li>
        </Fragment>
      ))}
      <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
      <li>
        <Pill icon={Flag}>
          {t("appcfg.flow.finalize")}
          <Lock aria-label={t("appcfg.flow.locked")} className="size-3" />
        </Pill>
      </li>
    </ol>
  );
}

export function SlotFlowView({ defId }: { defId: string | undefined }) {
  const { t } = useTranslation();
  const who = useWho();
  const { rows, pending, error } = useSlotFlow(defId);
  if (!defId) return null;
  if (pending)
    return <p className="text-caption text-muted-foreground">{t("appcfg.flow.loading")}</p>;
  if (error || !rows)
    return <p className="text-caption text-muted-foreground">{t("appcfg.flow.unavailable")}</p>;
  return (
    <div className="space-y-3" data-testid="slot-flow">
      <h4 className="text-label font-semibold">{t("appcfg.flow.title")}</h4>
      <Diagram rows={rows} />
      <Table>
        <caption className="sr-only">{t("appcfg.flow.title")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("appcfg.flow.col.step")}</TableHead>
            <TableHead>{t("appcfg.flow.col.who")}</TableHead>
            <TableHead>{t("appcfg.flow.col.timing")}</TableHead>
            <TableHead>{t("appcfg.flow.col.condition")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="whitespace-normal font-medium">{`${r.index}. ${r.name}`}</TableCell>
              <TableCell className="whitespace-normal">{who(r.who)}</TableCell>
              <TableCell className="whitespace-normal">
                {r.timing
                  ? r.timing.remindH
                    ? t("appcfg.flow.timingRemind", {
                        due: r.timing.dueH,
                        remind: r.timing.remindH,
                      })
                    : t("appcfg.flow.timing", { due: r.timing.dueH })
                  : "—"}
              </TableCell>
              <TableCell className="whitespace-normal">
                {r.condition ?? t("appcfg.flow.always")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
