// CR-121 c11 · ngăn chi tiết một việc (bấm hàng): tóm tắt, các bước (canvas mặc định), Gán/Đổi + luật định tuyến + Mặc định, Đang chạy.
import { useTranslation } from "react-i18next";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import { Button } from "@/components/ui/button";
import type { FlowJob } from "../lib/flow-rows";
import { DrawerAssign } from "./DrawerAssign";
import { DrawerRunning } from "./DrawerRunning";
import { DrawerSteps } from "./DrawerSteps";
import { useJobName } from "./JobRow";

function lineOf(job: FlowJob, t: (k: string) => string): string {
  if (job.reason) return t(`tenants.flows.reason.${job.reason}`);
  return `${job.defName ?? ""}${job.version ? ` · v${job.version}` : ""}`;
}

export function FlowDrawer({
  tenantId,
  job,
  isPlatform,
  onClose,
}: {
  tenantId: string;
  job: FlowJob | null;
  isPlatform: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const jobName = useJobName();
  const on = job?.status === "on";
  return (
    <DetailDrawer
      open={!!job}
      onClose={onClose}
      kind={t("tenants.flows.drawerKind")}
      title={job ? jobName(job) : ""}
      status={
        job
          ? { label: t(on ? "tenants.flows.on" : "tenants.flows.off"), tone: on ? "ok" : "off" }
          : undefined
      }
      line={job ? lineOf(job, t) : null}
      footer={
        <Button type="button" onClick={onClose} data-testid="flows-drawer-done">
          {t("tenants.flows.rulesDone")}
        </Button>
      }
    >
      {job ? (
        <div className="flex flex-col gap-6" data-testid="flows-drawer">
          <DrawerSteps
            key={`${job.slot}:${job.defId ?? "none"}`}
            tenantId={tenantId}
            slot={job.slot}
            defId={job.defId}
            isPlatform={isPlatform}
          />
          <DrawerAssign
            tenantId={tenantId}
            slot={job.slot}
            jobName={jobName(job)}
            isPlatform={isPlatform}
            appOff={job.appOff}
          />
          <DrawerRunning
            tenantId={tenantId}
            slot={job.slot}
            jobName={jobName(job)}
            isPlatform={isPlatform}
          />
        </div>
      ) : null}
    </DetailDrawer>
  );
}
