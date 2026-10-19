// HD-FR-22 · HD-FR-26 · S05 · D-02: lưới trường kiểm/sửa — port nguyên `ContractPage.tsx:142-157` (nhãn, "· chưa kiểm chứng",
// trích dẫn nghiêng dưới ô). Chỉ trình bày.
import type { ContractDetail, ContractFieldKey } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { type Draft, SHOWN, unverified, WIDE } from "../lib/review";

export function ReviewFields({
  contract,
  draft,
  write,
  onChange,
}: {
  contract: Pick<ContractDetail, "fields">;
  draft: Draft;
  write: boolean;
  onChange: (k: ContractFieldKey, v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Panel className="mb-4 p-5">
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        {SHOWN.map(([k, label, kind]) => (
          <label
            key={k}
            className={`text-[13px] ${WIDE.has(k) ? "col-span-2 max-sm:col-span-1" : ""}`}
          >
            <span className="flex gap-2">
              {t(`contracts.review.fields.${label}`)}
              {unverified(contract, k) && (
                <span className="text-soon">{t("contracts.review.unverified")}</span>
              )}
            </span>
            <input
              className="field mt-1"
              type={kind === "date" ? "date" : "text"}
              disabled={!write}
              value={draft[k] ?? ""}
              onChange={(e) => onChange(k, e.target.value)}
            />
            {contract.fields[k]?.quote && (
              <span className="mt-1 block text-[12px] text-dim italic">
                “{contract.fields[k].quote}”
              </span>
            )}
          </label>
        ))}
      </div>
    </Panel>
  );
}
