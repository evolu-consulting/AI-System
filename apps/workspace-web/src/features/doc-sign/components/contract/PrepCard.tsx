// CR-181 · s13 · thẻ của NGƯỜI TẢI LÊN (HĐ nháp / bị trả lại): danh sách kiểm tra từ `readiness` + «Chuẩn bị chỗ ký».
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { checklist } from "../../lib/contract-view";
import { OpenSign } from "./SignBox";

export function PrepCard({ id, session }: { id: string; session: SignSessionOut }) {
  const { t } = useTranslation();
  const items = checklist(session);
  return (
    <section data-testid="sign-prep" className="mb-3 rounded-lg border border-rule bg-panel p-4">
      <h3 className="font-semibold">{t("contracts.docsignc.prepTitle")}</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((i) => (
          <li
            key={`${i.key}${i.name ?? ""}${i.file ?? ""}`}
            data-ok={i.ok ? "1" : "0"}
            className="flex gap-2"
          >
            <span aria-hidden="true" className={i.ok ? "text-ok" : "text-late"}>
              {i.ok ? "✓" : "✗"}
            </span>
            <span>
              {i.key === "hasFile"
                ? t("contracts.docsignc.chkFile")
                : i.name
                  ? t("contracts.docsignc.chkFieldsFor", { name: i.name, file: i.file })
                  : t("contracts.docsignc.chkFields")}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <OpenSign
          id={id}
          label={t("contracts.docsignc.prepOpen")}
          testId="sign-prep-open"
          variant="outline"
        />
      </div>
    </section>
  );
}
