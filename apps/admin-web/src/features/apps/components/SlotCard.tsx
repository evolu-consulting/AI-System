// CR-118 · cr118-app-config · thẻ MỘT khe quy trình của app: quy trình mặc định (+ phiên bản), đổi mặc định, nhân bản để sửa, quy trình khác của khe,
// công ty đang dùng. Sửa luôn mở ProcessEditorPage (/processes/$id — editor duy nhất, CR-105: nháp → xuất bản → tác động).
import type { AppSlotDecl } from "@ai/contracts/app-manifest";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { processErrorSpec } from "@/features/processes/lib/errors";
import { setSlotDefault, useLibraryRefresh } from "@/features/processes/library-api";
import type { SlotView } from "../hooks/use-app-processes";
import { SlotDeclInfo } from "./SlotDeclInfo";
import { SlotFlowView } from "./SlotFlowView";

type Props = {
  view: SlotView;
  /** CR-120 · khai báo khe từ manifest (mục đích, sự kiện, luôn bật/add-on). */
  decl?: AppSlotDecl | null;
  onClone: (src: { id: string; name: string }) => void;
  onOpenCompanies: () => void;
};

export function SlotCard({ view, decl, onClone, onOpenCompanies }: Props) {
  const { t } = useTranslation();
  const refresh = useLibraryRefresh();
  const [pick, setPick] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { slot, defs } = view;
  const current = defs.find((d) => d.is_default) ?? defs.find((d) => d.id === slot.default_def_id);
  const others = defs.filter((d) => d.id !== current?.id);
  const candidates = others.filter((d) => d.published_version != null && d.enabled);
  const picked = candidates.find((d) => d.id === pick);
  const used = others.filter((d) => (d.tenant_count ?? 0) > 0);
  const changeDefault = async () => {
    if (!picked) return;
    try {
      await setSlotDefault(slot.slot, picked.id);
      notifySuccess(t("appcfg.processes.defaultDone", { name: picked.name }));
      setPick("");
      await refresh();
    } catch (err) {
      const s = processErrorSpec(err);
      notifyError(t(s.key, s.params));
    }
  };
  return (
    <section
      aria-label={slot.label}
      data-testid={`app-slot-${slot.slot}`}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <header>
        <h3 className="text-h3 font-semibold">{slot.label}</h3>
        <p className="font-mono text-caption text-muted-foreground">{slot.slot}</p>
      </header>
      {decl ? <SlotDeclInfo decl={decl} /> : null}
      <div className="flex flex-wrap items-center gap-2 text-body">
        <span className="text-muted-foreground">{t("appcfg.processes.default")}:</span>
        <span className="font-medium">
          {current?.name ?? slot.default_def_name ?? t("appcfg.processes.noDefault")}
        </span>
        {current?.published_version != null ? (
          <StatusBadge tone="info">{`v${current.published_version}`}</StatusBadge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/processes/$processId" params={{ processId: current.id }}>
                {t("appcfg.processes.view")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => onClone(current)}>
              {t("appcfg.processes.clone")}
            </Button>
          </>
        ) : null}
        <Select value={pick} onValueChange={setPick} disabled={candidates.length === 0}>
          <SelectTrigger className="w-64" aria-label={t("appcfg.processes.pickDefault")}>
            <SelectValue placeholder={t("appcfg.processes.pickDefaultPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((d) => (
              <SelectItem
                key={d.id}
                value={d.id}
              >{`${d.name} · v${d.published_version}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!picked} onClick={() => setConfirm(true)}>
          {t("appcfg.processes.changeDefault")}
        </Button>
      </div>
      <SlotFlowView defId={current?.id} />
      <div className="space-y-1">
        <h4 className="text-label font-semibold">{t("appcfg.processes.others")}</h4>
        {others.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("appcfg.processes.noOthers")}</p>
        ) : (
          <ul className="space-y-1">
            {others.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-body">
                <Link
                  to="/processes/$processId"
                  params={{ processId: d.id }}
                  className="font-medium hover:underline"
                >
                  {d.name}
                </Link>
                <StatusBadge tone={d.published_version == null ? "warn" : "ok"}>
                  {d.published_version == null
                    ? t("appcfg.processes.draftOnly")
                    : `v${d.published_version}`}
                </StatusBadge>
                {d.has_unpublished_changes ? (
                  <StatusBadge tone="warn">{t("appcfg.processes.unpublished")}</StatusBadge>
                ) : null}
                <span className="text-caption text-muted-foreground">
                  {t("appcfg.processes.usedBy", { count: d.tenant_count ?? 0 })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-caption text-muted-foreground">
        {used.length === 0
          ? t("appcfg.processes.noUsers")
          : used.map((d) => `${d.name} ${d.tenant_count}`).join(" · ")}{" "}
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onOpenCompanies}>
          {t("appcfg.processes.openCompanies")}
        </Button>{" "}
        <Button variant="link" size="sm" className="h-auto p-0" asChild>
          <Link to="/processes" search={{ app: slot.slot.split(".")[0] }}>
            {t("appcfg.processes.openList")}
          </Link>
        </Button>
      </p>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("appcfg.processes.confirmTitle", { name: picked?.name ?? "" })}
        description={t("appcfg.processes.confirmDesc")}
        confirmLabel={t("appcfg.processes.changeDefault")}
        onConfirm={changeDefault}
      />
    </section>
  );
}
