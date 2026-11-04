// gap-d1 #22 · "Thêm vào Đối tác" trên một dòng giá NCC: `POST /companies` (tên; MST khi khoá đối tác là `tax:<MST>`). Đã có ⇒ coi như xong.

import type { SupplierPriceRow } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { isConflict, useAddCompany } from "../hooks/use-quote";
import { companyBody } from "../lib/suppliers";

export function AddPartnerButton({ row }: { row: SupplierPriceRow }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.partner.${k}`);
  const [done, setDone] = useState(false);
  const add = useAddCompany();
  if (done) return <span className="tag text-[11px]">{L("added")}</span>;
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      data-testid="gd1-add-partner"
      disabled={add.isPending}
      onClick={() =>
        add.mutate(companyBody(row), {
          onSuccess: () => {
            setDone(true);
            toast(L("ok"));
          },
          onError: (e) => {
            if (isConflict(e)) setDone(true);
            else toast(L("fail"), "late");
          },
        })
      }
    >
      {L("add")}
    </button>
  );
}
