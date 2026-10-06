// HUB-FR-64 · H4a-R04 · bước ③ Workflow được gắn làm tool: danh sách gắn (key, mô tả, [Gỡ]) + picker catalog.
// Studio không lưu workflow (đọc từ catalog Admin); workflow không còn trong catalog hiện theo `agent.workflows` / id.
import type { Agent } from "@ai/contracts/studio";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { ADMIN_URL } from "#/lib/env";
import type { Catalog, WorkflowItem } from "../../hooks/use-editor-catalogs";
import type { SectionProps } from "../editor/AgentField";
import { CatalogAlert } from "../editor/CatalogAlert";
import { WorkflowPicker } from "./WorkflowPicker";

type Props = SectionProps & {
  workflows: Catalog<WorkflowItem>;
  attached: Agent["workflows"];
};

const isSingle = (rt: string) => rt === "dify-workflow" || rt === "dify-agent";

function Attached({ draft, set, workflows, attached }: Props) {
  const { t } = useTranslation();
  const info = new Map<string, { key: string; desc: string }>();
  for (const w of attached) info.set(w.id, { key: w.key, desc: w.description ?? w.name });
  for (const w of workflows.items) info.set(w.id, { key: w.key, desc: w.description ?? w.name });
  if (draft.workflowIds.length === 0)
    return <p className="text-body text-muted-foreground">{t("editor.wf.empty")}</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {draft.workflowIds.map((id) => {
        const w = info.get(id);
        return (
          <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <span className="font-mono text-body">{w?.key ?? id}</span>
              <p className="truncate text-label text-muted-foreground">
                {w?.desc ?? t("editor.wf.missing")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("editor.wf.removeKey", { key: w?.key ?? id })}
              onClick={() =>
                set(
                  "workflowIds",
                  draft.workflowIds.filter((x) => x !== id),
                )
              }
            >
              {t("editor.wf.remove")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function WorkflowSection(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const single = isSingle(p.draft.runtime);
  const need = single ? p.draft.runtime : "tool";
  const usable = p.workflows.items.filter((w) => (w.usable_for as string[]).includes(need));
  return (
    <div className="space-y-3">
      {p.workflows.failed ? <CatalogAlert what="workflows" retry={p.workflows.retry} /> : null}
      <Attached {...p} />
      {p.errors.workflow_ids ? (
        <p id="f-wf-err" role="alert" className="text-label text-danger">
          {t(p.errors.workflow_ids)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          {t("editor.wf.add")}
        </Button>
        <p className="text-label text-muted-foreground">
          {t("editor.wf.hint")}{" "}
          {ADMIN_URL ? (
            <a
              className="underline"
              href={`${ADMIN_URL}/workflows`}
              target="_blank"
              rel="noreferrer"
            >
              {t("editor.wf.adminLink")}
            </a>
          ) : (
            t("editor.wf.adminText")
          )}
        </p>
      </div>
      {open ? (
        <WorkflowPicker
          items={usable}
          single={single}
          selected={p.draft.workflowIds}
          onClose={() => setOpen(false)}
          onAttach={(ids) => {
            p.set("workflowIds", ids);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
