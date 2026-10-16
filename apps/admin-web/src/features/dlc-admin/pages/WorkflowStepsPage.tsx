// DLC-R15 · /workflows/steps — Workflow Steps: các bước của dây chuyền AI SDLC theo chiều chạy, mỗi bước: agent (vai trò,
// kiểu, model đang dùng), hook gắn ở biên bước. Chỉ đọc (model đổi ở engine, hook sửa ở admin engine).
import type { DlcCatalogResponse, DlcCatalogStep } from "@ai/contracts/hub-admin";
import { Bot, Webhook } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { Badge } from "@/components/ui/badge";
import { useDlcCatalog } from "../api";
import { StepFlow } from "../components/StepFlow";

function StepCard({
  step,
  index,
  catalog,
}: {
  step: DlcCatalogStep;
  index: number;
  catalog: DlcCatalogResponse;
}) {
  const { t } = useTranslation();
  const agents = catalog.agents.filter((a) => step.roles.includes(a.role));
  const hooks = catalog.hooks.filter((h) => step.hook_events.includes(h.event));
  return (
    <article className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <header className="flex items-start gap-2">
        <span className="text-label font-semibold text-muted-foreground">{index + 1}</span>
        <h2 className="min-w-0 flex-1 text-label leading-tight font-semibold">{step.title}</h2>
        {step.optional && <Badge variant="off">{t("dlcAdmin.optional")}</Badge>}
      </header>
      <section aria-label={t("dlcAdmin.agents")} className="flex flex-col gap-1">
        {agents.map((a) => (
          <div key={a.role} className="flex items-start gap-1.5 text-micro" title={a.does}>
            <Bot aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="font-mono font-medium">dlc-{a.role.replaceAll("_", "-")}</span>
              <span className="text-muted-foreground">
                {" "}
                · {a.kind} · {a.model}
              </span>
            </span>
          </div>
        ))}
      </section>
      {step.hook_events.length > 0 && (
        <section
          aria-label={t("dlcAdmin.hooks")}
          className="mt-auto border-t border-border pt-2 text-micro"
        >
          <p className="text-muted-foreground">
            {t("dlcAdmin.hookEvent", { events: step.hook_events.join(", ") })}
          </p>
          {hooks.length === 0 ? (
            <p className="text-muted-foreground">{t("dlcAdmin.noHooks")}</p>
          ) : (
            hooks.map((h) => (
              <p key={h.id} className="flex items-center gap-1.5">
                <Webhook aria-hidden className="size-3.5 shrink-0" />
                {h.name} · {h.event} · {h.mode}
              </p>
            ))
          )}
        </section>
      )}
    </article>
  );
}

function StepsContent() {
  const { t } = useTranslation();
  const q = useDlcCatalog();
  const c = q.data;
  let body = <p>{t("dlcAdmin.loading")}</p>;
  if (c?.engine === "unreachable") body = <p>{t("dlcAdmin.engineDown")}</p>;
  else if (c?.engine === "not_configured") body = <p>{t("dlcAdmin.engineOff")}</p>;
  else if (c)
    body = (
      <>
        <p className="mb-4 text-label text-muted-foreground">
          {t("dlcAdmin.defaultModel", { model: c.default_model })}
        </p>
        <StepFlow steps={c.steps} render={(s, i) => <StepCard step={s} index={i} catalog={c} />} />
      </>
    );
  return (
    <>
      <PageHeader title={t("dlcAdmin.stepsTitle")} description={t("dlcAdmin.stepsSubtitle")} />
      {body}
    </>
  );
}

export function WorkflowStepsPage() {
  return (
    <PlatformOnly>
      <StepsContent />
    </PlatformOnly>
  );
}
