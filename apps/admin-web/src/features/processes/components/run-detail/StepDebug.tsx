// CR-121 · R-3: tab "Gỡ lỗi" của nhật ký bước (chỉ platform_admin; server đã che secret) — các lần chạy, job, thử lại, tri thức.
import type { RunStageLog } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { formatClock } from "@/lib/format";

export function StepDebug({ debug }: { debug: NonNullable<RunStageLog["debug"]> }) {
  const { t } = useTranslation();
  const T = (k: string, o?: Record<string, unknown>) => t(`process.admin.runDetail.debug.${k}`, o);
  return (
    <div className="space-y-3 text-body">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{T("lastError")}</dt>
        <dd className="m-0 font-mono">{debug.last_error_code ?? "—"}</dd>
        <dt className="text-muted-foreground">{T("khQueries")}</dt>
        <dd className="m-0">{debug.kh_queries ?? "—"}</dd>
        {debug.kh_warning && (
          <>
            <dt className="text-muted-foreground">{T("khWarning")}</dt>
            <dd className="m-0 font-mono">{debug.kh_warning}</dd>
          </>
        )}
      </dl>
      {debug.attempts.map((a) => (
        <section key={`${a.run_id}-${a.n}`} className="rounded-lg border border-border p-3">
          <h4 className="m-0 text-label font-semibold">{T("attempt", { n: a.n })}</h4>
          <p className="m-0 text-muted-foreground">
            {a.status} · {formatClock(a.started_at)} · {T("tokens", { n: a.tokens_used })}
          </p>
          {a.error_message && (
            <p className="m-0 break-words text-danger">
              {a.error_code}: {a.error_message}
            </p>
          )}
          {a.jobs.map((j) => (
            <details key={j.id} className="mt-2">
              <summary className="cursor-pointer">
                {T("job")} {j.status} · {j.attempts}
                {j.error_code ? ` · ${j.error_code}` : ""}
              </summary>
              {j.error_message && <p className="m-0 break-words text-danger">{j.error_message}</p>}
              <pre className="m-0 mt-1 max-h-60 overflow-auto rounded bg-muted p-2 text-caption whitespace-pre-wrap break-words">
                {JSON.stringify(j.payload ?? null, null, 2)}
              </pre>
            </details>
          ))}
        </section>
      ))}
      {debug.retries.length > 0 && (
        <ul className="m-0 list-none p-0 text-muted-foreground">
          {debug.retries.map((r) => (
            <li key={r.created_at}>
              {T("retry", { due: formatClock(r.due_at) })}
              {r.cancelled_at ? ` · ${T("cancelled")}` : r.fired_at ? ` · ${T("fired")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
