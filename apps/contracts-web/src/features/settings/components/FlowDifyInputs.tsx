// dify-input-map · bước Dify: mỗi tham số của quy trình lấy giá trị từ một trường hợp đồng ("Lấy từ trường hợp đồng").
import type { FlowContractField } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import type { DifyWorkflowItem, FlowDifyStep } from "../api-flow";
import { effectiveField, fieldsFor, setMapping } from "../lib/flow-dify-map";
import { FIELD } from "./controls";

type Props = {
  step: FlowDifyStep;
  workflow: DifyWorkflowItem | undefined;
  err: (field: string) => string | undefined;
  onPatch: (p: Partial<FlowDifyStep>) => void;
};

export function FlowDifyInputs({ step, workflow, err, onPatch }: Props) {
  const { t } = useTranslation();
  const f = (k: string) => t(`contracts.flow.${k}`);
  if (!workflow || workflow.inputs.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-2" data-testid="flow-dify-inputs">
      {workflow.inputs.map((p) => {
        const e = err(`inputs.${p.name}`);
        const cur = effectiveField(step, p);
        return (
          <li key={p.name} className="grid grid-cols-2 items-start gap-3 max-md:grid-cols-1">
            <div className="flex flex-col">
              <span className="text-label">
                {p.name}
                {p.required && <span className="text-late"> *</span>}
              </span>
              {p.description && <span className="text-caption text-dim">{p.description}</span>}
            </div>
            <div className="flex flex-col gap-1">
              <select
                className={FIELD}
                aria-label={`${f("difyFrom")}: ${p.name}`}
                value={cur ?? ""}
                onChange={(ev) =>
                  onPatch({
                    inputs: setMapping(
                      step.inputs,
                      p.name,
                      ev.target.value as FlowContractField | "",
                    ),
                  })
                }
              >
                <option value="">{p.required ? f("pick") : f("difyNoSend")}</option>
                {fieldsFor(p.type).map((c) => (
                  <option key={c} value={c}>
                    {f(`contractField.${c}`)}
                  </option>
                ))}
              </select>
              {e && (
                <span role="alert" className="text-caption text-late">
                  {e}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
