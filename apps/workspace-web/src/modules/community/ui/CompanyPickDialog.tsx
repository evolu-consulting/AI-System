// CR-195 BR-195-8 · hộp chọn công ty cho «Ai thấy bài» = «Chọn công ty…»: ô tìm, công ty đã kết nối + đối tác có ô chọn, «Xong (n)». Điện thoại toàn màn.
import type { ConnectedAudienceCompany, PostAudience } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Checkbox } from "@ai/web-kit/ui/kit/checkbox";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { t } from "../i18n";
import { CompanyPicker } from "./CompanyPicker";

const toggle = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

export function CompanyPickDialog({
  open,
  onOpenChange,
  value,
  connected,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: PostAudience;
  connected: ConnectedAudienceCompany[];
  onChange: (a: PostAudience) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const conn = connected.filter((c) => c.name.toLowerCase().includes(needle));
  const n = value.tenants.length + value.companies.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[520px] max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:rounded-none max-sm:border-0"
        aria-describedby={undefined}
        data-testid="company-pick-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("community.audience.pickTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          type="search"
          data-testid="company-search"
          placeholder={t("community.audience.companySearch")}
          aria-label={t("community.audience.companySearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <DialogBody>
          {conn.length > 0 && (
            <section data-testid="audience-companies">
              <div className="fhint">{t("community.audience.connectedTitle")}</div>
              <ul className="companyrows">
                {conn.map((c) => (
                  <li key={c.tenantId}>
                    <div className="companyrow">
                      <Checkbox
                        id={`ct-${c.tenantId}`}
                        checked={value.tenants.includes(c.tenantId)}
                        onCheckedChange={() =>
                          onChange({ ...value, tenants: toggle(value.tenants, c.tenantId) })
                        }
                      />
                      <label htmlFor={`ct-${c.tenantId}`}>{c.name}</label>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <CompanyPicker
            q={q}
            selected={value.companies}
            onToggle={(id) => onChange({ ...value, companies: toggle(value.companies, id) })}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            variant="primary"
            data-testid="company-pick-done"
            onClick={() => onOpenChange(false)}
          >
            {t("community.audience.pickDone", { n })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
