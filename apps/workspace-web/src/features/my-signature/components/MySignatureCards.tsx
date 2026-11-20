// CR-181 · s4 · Q11/Q12 · thẻ «Chữ ký nội bộ đang dùng» + «Chữ ký số». Thuần trình bày; một cột ở điện thoại.
import type { MySignatureView } from "@ai/contracts/signature";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SignatureVersions } from "./SignatureVersions";

const HOW = { draw: "howDraw", upload: "howUpload", type: "howType" } as const;

function Card(p: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid content-start gap-3 rounded-[10px] border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{p.title}</h2>
        {p.action}
      </div>
      {p.children}
    </section>
  );
}

export function MySignatureCards(p: {
  view: MySignatureView;
  onCreate: () => void;
  onRequest: () => void;
  requesting?: boolean;
  /** CR-188 · phiên bản đang xem giấy tờ đã ký (BR-188-5). */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const v = p.view;
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === "en" ? "en-GB" : "vi-VN");
  const how = (m: keyof typeof HOW) => t(`contracts.mySig.page.${HOW[m]}`);
  const asked = v.change === "requested";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card
        title={t("contracts.mySig.page.inUse")}
        action={
          <Button variant="outline" disabled={!v.can_change} onClick={p.onCreate}>
            {t("contracts.mySig.page.create")}
          </Button>
        }
      >
        {!v.can_change && (
          <div className="grid gap-2" data-testid="sig-locked">
            <p className="text-sm text-muted-foreground">
              {t(asked ? "contracts.mySig.page.requested" : "contracts.mySig.page.locked")}
            </p>
            {!asked && (
              <div>
                <Button variant="outline" busy={p.requesting} onClick={p.onRequest}>
                  {t("contracts.mySig.page.request")}
                </Button>
              </div>
            )}
          </div>
        )}
        {v.main ? (
          <>
            <img
              src={v.main.image}
              alt={t("contracts.mySig.page.mainAlt")}
              className="max-h-40 w-full max-w-xl rounded-md border bg-card object-contain p-2"
            />
            <p className="text-sm text-muted-foreground">
              {t("contracts.mySig.page.since", {
                at: day(v.main.created_at),
                how: how(v.main.method),
              })}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("contracts.mySig.page.none")}</p>
        )}
        {v.initials && (
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold">{t("contracts.mySig.page.initialsLabel")}</h3>
            <img
              src={v.initials.image}
              alt={t("contracts.mySig.page.initialsAlt")}
              className="max-h-20 w-40 rounded-md border bg-card object-contain p-1"
            />
          </div>
        )}
        <h3 className="text-sm font-semibold">{t("contracts.mySig.page.history")}</h3>
        {v.history.length ? (
          <SignatureVersions history={v.history} selectedId={p.selectedId} onSelect={p.onSelect} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("contracts.mySig.page.noHistory")}</p>
        )}
      </Card>
      <Card
        title={t("contracts.mySig.page.digital")}
        action={<Badge icon={<Minus size={12} />}>{t("contracts.mySig.page.notAssigned")}</Badge>}
      >
        <p className="text-sm text-muted-foreground">
          {t(
            v.digital.enabled
              ? "contracts.mySig.page.digitalOn"
              : "contracts.mySig.page.digitalNote",
          )}
        </p>
      </Card>
    </div>
  );
}
