// CR-121 c11 · tên nghiệp vụ của một việc (khe) theo i18n `tenants.flows.job.*`; khe lạ ⇒ tên dự phòng. (CR-125 c7: tách khỏi JobRow đã gỡ.)
import { useTranslation } from "react-i18next";
import { type FlowJob, JOB_KEY, jobFallbackName } from "./flow-rows";

export function useJobName() {
  const { t } = useTranslation();
  return (j: Pick<FlowJob, "slot">): string => {
    const k = JOB_KEY[j.slot];
    return k ? t(`tenants.flows.job.${k}`) : jobFallbackName(j.slot);
  };
}
