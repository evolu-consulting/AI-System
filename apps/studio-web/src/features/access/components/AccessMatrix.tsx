// HUB-FR-78 · D9/D11 · artboard `Access.dc.html`: `table "Ma trận quyền agent"`, hàng = agent, cột = tenant.
// Agent tắt: tiêu đề hàng mờ + "Agent đang tắt"; tenant không hoạt động: cột mờ. Switch vẫn dùng được ở cả hai trường hợp.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { cn } from "#/lib/utils";
import {
  type Cell,
  cellKey,
  isNotApplicable,
  type MatrixAgent,
  type MatrixTenant,
} from "../lib/matrix";
import { AccessCell, type CellView } from "./AccessCell";

type Props = {
  agents: readonly MatrixAgent[];
  tenants: readonly MatrixTenant[];
  /** Mọi tenant (không lọc) để ra key của `only_tenant_id`. */
  allTenants: readonly MatrixTenant[];
  cells: Map<string, Cell>;
  onToggle: (v: CellView, next: boolean) => void;
  onOpen: (v: CellView) => void;
};

function AgentHeader({ agent }: { agent: MatrixAgent }) {
  const { t } = useTranslation();
  return (
    <th scope="row" className="px-2 py-2 text-left align-middle font-normal">
      <div className={cn("font-medium text-foreground", !agent.enabled && "opacity-60")}>
        {agent.name}
      </div>
      <div className="font-mono text-label text-muted-foreground">{agent.key}</div>
      {agent.enabled ? null : (
        <div className="text-label text-muted-foreground">{t("access.agentOff")}</div>
      )}
    </th>
  );
}

export function AccessMatrix({ agents, tenants, allTenants, cells, onToggle, onOpen }: Props) {
  const { t } = useTranslation();
  const tenantKey = useMemo(() => new Map(allTenants.map((x) => [x.id, x.key])), [allTenants]);
  return (
    <Table aria-label={t("access.matrix.aria")}>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("access.matrix.corner")}</TableHead>
          {tenants.map((tn) => (
            <TableHead key={tn.id} scope="col" className={cn(!tn.active && "opacity-60")}>
              {tn.name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((ag) => (
          <TableRow key={ag.id}>
            <AgentHeader agent={ag} />
            {tenants.map((tn) => {
              const c = cells.get(cellKey(ag.id, tn.id));
              const na = isNotApplicable(ag, tn);
              return (
                <AccessCell
                  key={tn.id}
                  agentId={ag.id}
                  tenantId={tn.id}
                  agentKey={ag.key}
                  tenantKey={tn.key}
                  on={c !== undefined}
                  count={c?.grant_count ?? 0}
                  onlyFor={na ? (tenantKey.get(ag.only_tenant_id ?? "") ?? "?") : null}
                  dim={!tn.active}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
