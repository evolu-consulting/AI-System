// ADM-FR-68 · PB-R21 · thân drawer theo trạng thái: không tìm thấy / đang tải / XEM (không form, không path) / form + kiểm tra kết nối.
import type { SourceView } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useTr } from "@/lib/use-translate";
import type { CheckState } from "../hooks/use-source-check";
import { CheckPanel } from "./CheckPanel";
import { SourceForm, type SourceFormProps } from "./SourceForm";
import { SourceViewBody } from "./SourceViewBody";

type Props = {
  notFound: boolean;
  ready: boolean;
  viewOnly: boolean;
  source: SourceView | undefined;
  alertKey: string | null;
  form: SourceFormProps;
  check: { state: CheckState; dirty: boolean; onRun: () => void };
};

export function SourceDrawerBody(p: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  if (p.notFound) {
    return (
      <p className="text-body text-muted-foreground">
        {t("process.sources.apiError.SOURCE_NOT_FOUND")}
      </p>
    );
  }
  if (!p.ready) return <Skeleton className="h-40 w-full" />;
  if (p.viewOnly && p.source) {
    return (
      <SourceViewBody
        sourceKey={p.source.key}
        kind={p.source.kind}
        description={p.source.description}
      />
    );
  }
  const blocked = p.form.mode === "new" ? "unsaved" : p.check.dirty ? "dirty" : null;
  return (
    <>
      {p.alertKey ? (
        <Alert variant="destructive">
          <p>{tr(p.alertKey)}</p>
        </Alert>
      ) : null}
      <SourceForm key={p.source?.version ?? "new"} {...p.form} />
      <CheckPanel state={p.check.state} blocked={blocked} onRun={p.check.onRun} />
    </>
  );
}
