// CR-104 · ops-ui · `/system` "Tình trạng hệ thống" (chỉ platform_admin): tóm tắt, 8 thẻ check, lịch sử, Kiểm tra ngay,
// Gói chẩn đoán (0 gọi mạng ngoài /ops/status), Cấu hình. Poll 60 s khi tab hiện (api.ts).
import { OPS_CHECK_KEYS, type OpsSettings, type OpsStatusResponse } from "@ai/contracts/hub-admin";
import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { copyText } from "@/lib/clipboard";
import { saveBlob } from "@/lib/download";
import { ApiError } from "@/lib/http";
import { hubConfigured } from "@/lib/hub";
import { useOpsStatus, useRunOpsCheck, useSaveOpsSettings } from "../api";
import { CheckCard, TONE, when } from "../components/CheckCard";
import { ConfigPanel } from "../components/ConfigPanel";
import { HistoryTable } from "../components/HistoryTable";
import {
  buildDiagnosticText,
  isCheckKey,
  nextDueAt,
  overallStatus,
  type SettingsErrors,
  serverErrors,
} from "../lib/ops";

const COOLDOWN_S = 60;

function useCountdown(): [number, (n: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, setLeft];
}

function SystemContent() {
  const { t } = useTranslation();
  const status = useOpsStatus();
  const check = useRunOpsCheck();
  const save = useSaveOpsSettings();
  const me = useSession((s) => s.me);
  const [cool, setCool] = useCountdown();

  if (!hubConfigured()) return <p>{t("system.notConfigured")}</p>;
  const err = status.error instanceof ApiError ? status.error : null;
  const data: OpsStatusResponse | undefined = status.data;

  const actorOf = (id: string | null): string =>
    id && me && id === me.id ? me.display_name : (id?.slice(0, 8) ?? "?");

  const runCheck = async () => {
    try {
      await check.mutateAsync();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setCool(COOLDOWN_S);
        return;
      }
      notifyError(t("system.checkFailed"));
    }
  };

  const diagText = (d: OpsStatusResponse): string =>
    buildDiagnosticText({
      now: new Date(),
      env: window.location.origin,
      rows: d.checks,
      events: d.events,
      settings: d.settings,
      labelOf: (k) => (isCheckKey(k) ? t(`system.check.${k}`) : k),
      actorOf,
      text: {
        title: t("system.diagText.title"),
        time: t("system.diagText.time"),
        env: t("system.diagText.env"),
        deploy: t("system.diagText.deploy"),
        checks: t("system.diagText.checks"),
        disabled: t("system.disabled"),
        events: t("system.diagText.events"),
        noEvents: t("system.history.empty"),
        settingsChanged: (u) => t("system.history.settings", { user: u }),
      },
    });

  const diag = async (d: OpsStatusResponse) => {
    const text = diagText(d);
    saveBlob(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
      `ops-diagnostic-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
    );
    if (await copyText(text)) notifySuccess(t("system.diagCopied"));
    else notifyError(t("system.copyFailed"));
  };

  const onSave = async (s: OpsSettings): Promise<SettingsErrors | null> => {
    try {
      await save.mutateAsync(s);
      notifySuccess(t("system.config.saved"));
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) return serverErrors(e.details);
      notifyError(t("toast.saveFailed"));
      return {};
    }
  };

  const overall = data ? overallStatus(data.checks, data.settings) : "unknown";
  const next = data ? nextDueAt(data.last_round_at, data.settings.every_min) : null;
  const rowOf = (k: string) => data?.checks.find((r) => r.check_key === k);

  return (
    <>
      <PageHeader
        title={t("system.title")}
        description={t("system.subtitle")}
        actions={
          <>
            <Button
              type="button"
              disabled={!data}
              variant="outline"
              onClick={() => data && void diag(data)}
            >
              <Download aria-hidden /> {t("system.diag")}
            </Button>
            <Button
              type="button"
              disabled={check.isPending || cool > 0}
              onClick={() => void runCheck()}
            >
              <RefreshCw aria-hidden className={check.isPending ? "animate-spin" : ""} />{" "}
              {cool > 0 ? t("system.rateLimited", { n: cool }) : t("system.checkNow")}
            </Button>
          </>
        }
      />
      {err ? (
        <ErrorState message={err.message} code={err.code} onRetry={() => void status.refetch()} />
      ) : null}
      {data ? (
        <div className="space-y-8">
          <div
            data-testid="sys-summary"
            data-status={overall}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card p-4"
          >
            <span className="flex items-center gap-2 font-medium">
              {t("system.summary.overall")}:{" "}
              <StatusBadge tone={TONE[overall]}>{t(`system.overall.${overall}`)}</StatusBadge>
            </span>
            <span className="text-sm text-muted-foreground">
              {t("system.summary.last")}:{" "}
              {data.last_round_at ? when(data.last_round_at) : t("system.summary.never")}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("system.summary.next")}: {next ? when(next.toISOString()) : "—"}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {OPS_CHECK_KEYS.map((k) => (
              <CheckCard
                key={k}
                checkKey={k}
                row={rowOf(k)}
                enabled={data.settings.checks[k].enabled}
              />
            ))}
          </div>
          <HistoryTable events={data.events} actorOf={actorOf} />
          <ConfigPanel server={data.settings} saving={save.isPending} onSave={onSave} />
        </div>
      ) : null}
    </>
  );
}

export function SystemPage() {
  return (
    <PlatformOnly>
      <SystemContent />
    </PlatformOnly>
  );
}
