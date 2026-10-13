// HUB-FR-132 · section "KnowledgeHub" trong Sửa agent: checkbox kết nối (≤ 5, số thứ tự = ưu tiên), [Lưu] riêng.
// Chỉ `agentic-cli` dùng được; agent khác ⇒ chỉ được gỡ (bỏ tick = gỡ hết, server nhận []) + câu giải thích.
import type { KhConnection } from "@ai/contracts/hub-admin";
import type { Agent } from "@ai/contracts/studio";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { ErrorState } from "#/components/shared/ErrorState";
import { HrefLink } from "#/components/shared/HrefLink";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Skeleton } from "#/components/ui/skeleton";
import { useKhConnections } from "#/features/settings/knowledgehub/hooks/use-kh-connections";
import { useAgentKnowledge } from "../../hooks/use-agent-knowledge";
import { KH_MAX, rowDisabled, showUntickNote } from "../../lib/knowledge-selection";

type Props = { agent: Agent; version: number; onSynced: (a: Agent) => void };
const VARIANT = { unchecked: "off", ok: "ok", error: "err" } as const;

type RowProps = {
  c: KhConnection;
  order: number;
  disabled: boolean;
  onChange: (on: boolean) => void;
};

function Row({ c, order, disabled, onChange }: RowProps) {
  const { t } = useTranslation();
  const id = `agent-kh-${c.id}`;
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Checkbox
        id={id}
        checked={order > 0}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <label htmlFor={id} className="text-label">
        {c.name}
      </label>
      {order > 0 ? <Badge variant="secondary">{order}</Badge> : null}
      <span className="break-all font-mono text-caption text-muted-foreground">{c.base_url}</span>
      <Badge variant={VARIANT[c.status]}>{t(`knowledgehub.status.${c.status}`)}</Badge>
      {c.status !== "ok" ? (
        <span className="text-caption text-muted-foreground">{t("agents.knowledge.notReady")}</span>
      ) : null}
    </li>
  );
}

export function AgentKnowledgeSection({ agent, version, onSynced }: Props) {
  const { t } = useTranslation();
  const kh = useKhConnections();
  const k = useAgentKnowledge({ agent, version, onSynced });
  const cli = agent.runtime === "agentic-cli";
  const full = k.ids.length >= KH_MAX;
  let body: ReactNode;
  if (kh.isPending) body = <Skeleton aria-busy="true" className="h-16 w-full" />;
  else if (kh.error) body = <ErrorState onRetry={() => void kh.refetch()} />;
  else if (kh.items.length === 0)
    body = (
      <p className="text-body text-muted-foreground">
        {t("agents.knowledge.empty")}{" "}
        <HrefLink path="/settings" className="underline">
          {t("agents.knowledge.settings")}
        </HrefLink>
      </p>
    );
  else
    body = (
      <ul className="space-y-2">
        {kh.items.map((c) => (
          <Row
            key={c.id}
            c={c}
            order={k.ids.indexOf(c.id) + 1}
            disabled={rowDisabled(k.ids.includes(c.id), cli, k.ids.length)}
            onChange={(on) => (cli ? k.toggle(c.id, on) : k.clear())}
          />
        ))}
      </ul>
    );
  return (
    <section
      aria-labelledby="agent-kh-title"
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <h3 id="agent-kh-title" className="text-section-title">
        {t("agents.knowledge.title")}
      </h3>
      <p className="text-body text-muted-foreground">{t("agents.knowledge.hint")}</p>
      {cli ? null : <p className="text-body">{t("agents.knowledge.cliOnly")}</p>}
      {k.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(k.error.key, k.error.params)}</AlertDescription>
        </Alert>
      ) : null}
      {body}
      {cli && full ? (
        <p className="text-caption text-muted-foreground">{t("agents.knowledge.max")}</p>
      ) : null}
      {showUntickNote(cli, k.ids.length) ? (
        <p className="text-caption text-muted-foreground">{t("agents.knowledge.untickNote")}</p>
      ) : null}
      {kh.hasNextPage ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void kh.fetchNextPage()}>
          {t("knowledgehub.loadMore")}
        </Button>
      ) : null}
      {k.dirty ? (
        <div className="flex justify-end">
          <Button type="button" disabled={k.saving} onClick={() => void k.save()}>
            {k.saving ? t("agents.knowledge.saving") : t("agents.knowledge.save")}
          </Button>
        </div>
      ) : null}
      {k.conflictProps ? <ConflictDialog {...k.conflictProps} /> : null}
    </section>
  );
}
