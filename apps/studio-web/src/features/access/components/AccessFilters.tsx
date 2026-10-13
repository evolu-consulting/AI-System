// HUB-FR-78 · lọc phía client (≤ 200 dòng/cột): `combobox "Lọc theo agent"`, `combobox "Lọc theo tenant"`; "" = Tất cả.
import { useTranslation } from "react-i18next";
import type { MatrixAgent, MatrixTenant } from "../lib/matrix";

type Props = {
  agents: readonly MatrixAgent[];
  tenants: readonly MatrixTenant[];
  agentId: string;
  tenantId: string;
  onAgent: (id: string) => void;
  onTenant: (id: string) => void;
};

const SELECT =
  "h-9 rounded-md border border-input bg-background px-3 text-body text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function AccessFilters(p: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <select
        aria-label={t("access.filter.agent")}
        className={SELECT}
        value={p.agentId}
        onChange={(e) => p.onAgent(e.target.value)}
      >
        <option value="">{t("access.filter.all")}</option>
        {p.agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.key}
          </option>
        ))}
      </select>
      <select
        aria-label={t("access.filter.tenant")}
        className={SELECT}
        value={p.tenantId}
        onChange={(e) => p.onTenant(e.target.value)}
      >
        <option value="">{t("access.filter.all")}</option>
        {p.tenants.map((x) => (
          <option key={x.id} value={x.id}>
            {x.key}
          </option>
        ))}
      </select>
    </div>
  );
}
