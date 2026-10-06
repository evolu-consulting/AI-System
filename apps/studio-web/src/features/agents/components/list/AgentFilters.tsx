// HUB-FR-60 · H4a-R11 · thanh tìm/lọc: ô tìm, nhóm radio runtime (chip), checkbox "Đang tắt". Trạng thái nằm trên URL.
import { AGENT_RUNTIMES, type AgentRuntime } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import type { AgentFilters as Filters } from "../../lib/filters";

type Props = {
  filters: Filters;
  onQuery: (q: string) => void;
  onRuntime: (r: AgentRuntime | undefined) => void;
  onStatus: (s: Filters["status"]) => void;
};

const chip =
  "inline-flex min-h-8 cursor-pointer items-center rounded-full border border-input bg-card px-3 text-label text-foreground has-[input:checked]:border-transparent has-[input:checked]:bg-primary has-[input:checked]:text-primary-foreground has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/50";

export function AgentFilters({ filters, onQuery, onRuntime, onStatus }: Props) {
  const { t } = useTranslation();
  const options: (AgentRuntime | undefined)[] = [undefined, ...AGENT_RUNTIMES];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        type="search"
        aria-label={t("agents.search")}
        placeholder={t("agents.searchPlaceholder")}
        value={filters.q}
        onChange={(e) => onQuery(e.target.value)}
        className="w-72 max-w-full"
      />
      <div
        role="radiogroup"
        aria-label={t("agents.filter.runtime")}
        className="flex flex-wrap gap-2"
      >
        {options.map((r) => (
          <label key={r ?? "all"} className={chip}>
            <input
              type="radio"
              name="agent-runtime"
              className="sr-only"
              checked={filters.runtime === r}
              onChange={() => onRuntime(r)}
            />
            {r ?? t("agents.filter.all")}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="agents-off"
          checked={filters.status === "off"}
          onCheckedChange={(v) => onStatus(v === true ? "off" : undefined)}
        />
        <label htmlFor="agents-off" className="text-label">
          {t("agents.filter.off")}
        </label>
      </div>
    </div>
  );
}
