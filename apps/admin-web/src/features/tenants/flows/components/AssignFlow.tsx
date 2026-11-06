// CR-122 · U2b · FLOW2-FR-05: platform_admin gán một flow Thư viện cho công ty (POST company-flows). Chỉ hiện flow chưa gán.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useLibraryDefs } from "@/features/processes/library-api";

type Props = {
  assignedFlowIds: ReadonlySet<string>;
  busy: boolean;
  onAssign: (flowId: string) => void;
};

export function AssignFlow({ assignedFlowIds, busy, onAssign }: Props) {
  const { t } = useTranslation();
  const q = useLibraryDefs("library", true);
  const [pick, setPick] = useState("");
  const options = (q.data?.pages ?? [])
    .flatMap((p) => p.items)
    .filter((d) => !assignedFlowIds.has(d.id));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="company-flow-assign">
      <select
        aria-label={t("tenants.companyFlows.assign.pick")}
        className="h-9 w-full max-w-80 rounded-md border border-input bg-background px-2 text-body"
        value={pick}
        disabled={busy}
        onChange={(e) => setPick(e.target.value)}
      >
        <option value="">{t("tenants.companyFlows.assign.placeholder")}</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        disabled={busy || !pick}
        onClick={() => {
          onAssign(pick);
          setPick("");
        }}
      >
        {t("tenants.companyFlows.assign.add")}
      </Button>
    </div>
  );
}
