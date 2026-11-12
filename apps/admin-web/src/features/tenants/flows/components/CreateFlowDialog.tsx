// CR-127 · U2 · M1 (mock Main.dc) · hộp "Tạo quy trình": Công ty (dropdown + một dòng tóm tắt) → Tên → "Bắt đầu từ" HAI thẻ (Sơ đồ trống / Từ mẫu Thư viện)
// → "Tạo và mở sơ đồ" (xong mở thẳng màn soạn). Ứng dụng: công ty bật MỘT app có quy trình ⇒ dùng luôn; ≥ 2 ⇒ hỏi "Quy trình cho"; không có ⇒ nói rõ + link.
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssignableTenants } from "@/features/processes/hooks/use-assignable-tenants";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useTenantCompanyProfile, useTenantPacks } from "../../api";
import { useCompanyFlowOp } from "../company-flows-api";

/** `tenantId` vắng ⇒ hộp tự hỏi CÔNG TY trước (mở từ trang Quy trình); có ⇒ mở từ tab Quy trình của công ty đó. */
type Props = {
  tenantId?: string;
  tenantName?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
};
/** Các app có quy trình theo sự kiện (có manifest) — thứ tự ưu tiên: Sổ Hợp Tác trước. */
const FLOW_APPS = Object.keys(APP_MANIFESTS).sort((a, b) =>
  a === "contracts" ? -1 : b === "contracts" ? 1 : a.localeCompare(b),
);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 · M1 — hộp nhiều ô, tách ở đợt dọn sau
export function CreateFlowDialog({ tenantId, tenantName, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const navigate = useNavigate();
  const [picked, setPicked] = useState("");
  const companies = useAssignableTenants(open && tenantId === undefined);
  const tid = tenantId ?? picked;
  const company = tenantName ?? companies.items.find((c) => c.id === picked)?.name ?? "";
  const op = useCompanyFlowOp(tid);
  const packs = useTenantPacks(tid, open && tid !== "");
  const profile = useTenantCompanyProfile(tid, open && tid !== "");
  const appName = (a: string) => tr(`featmeta.app.${a}.name`, { defaultValue: a });
  const apps = useMemo(() => {
    const on = new Set((packs.data?.items ?? []).filter((p) => p.enabled).map((p) => p.key));
    return FLOW_APPS.filter((a) => on.has(a));
  }, [packs.data]);
  const [app, setApp] = useState("");
  useEffect(() => {
    if (!apps.includes(app)) setApp(apps[0] ?? "");
  }, [apps, app]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const noApp = tid !== "" && packs.isSuccess && apps.length === 0;
  const depts = profile.data?.departments ?? [];
  const members = depts.reduce((n, d) => n + d.member_count, 0);
  const ready = tid !== "" && name.trim() !== "" && app !== "";
  const errText = (e: unknown): string => {
    if (!(e instanceof ApiError)) return t("tenants.companyFlows.create.failed");
    const code = String(e.code);
    // thông điệp của Hub đã là câu nghiệp vụ nói cách sửa (FLOW_APP_REQUIRED, FLOW_NOT_ASSIGNABLE, FLOW_NAME_REQUIRED…)
    return code.startsWith("FLOW_") && e.message
      ? e.message
      : t("tenants.companyFlows.create.failed");
  };
  const submit = () =>
    op.mutate(
      {
        op: "create",
        body: {
          name: name.trim(),
          app,
          from: "blank",
        },
      },
      {
        onSuccess: (res) => {
          const id = (res as unknown as { flow_id?: string }).flow_id;
          setName("");
          setErr(null);
          onOpenChange(false);
          if (id)
            void navigate({
              to: "/processes/$processId",
              params: { processId: id },
              search: { company: tid },
            });
        },
        onError: (e) => setErr(errText(e)),
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-flow-dialog">
        <DialogHeader>
          <DialogTitle>{t("tenants.companyFlows.create.titleGeneric")}</DialogTitle>
          <DialogDescription>{t("tenants.companyFlows.create.hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {tenantId === undefined ? (
            <div className="space-y-1" data-testid="create-flow-company">
              <Label htmlFor="create-flow-company-select">
                {t("tenants.companyFlows.create.company")}
              </Label>
              <Select value={picked || undefined} onValueChange={setPicked}>
                <SelectTrigger id="create-flow-company-select">
                  <SelectValue placeholder={t("tenants.companyFlows.create.companyPh")} />
                </SelectTrigger>
                <SelectContent>
                  {companies.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">{company}</p>
          )}
          {tid !== "" && profile.data ? (
            <p className="text-caption text-muted-foreground" data-testid="create-flow-summary">
              {t("tenants.companyFlows.create.summary", {
                depts: depts.length,
                members,
                apps: apps.length
                  ? apps.map(appName).join(", ")
                  : t("tenants.companyFlows.create.noneOn"),
              })}
            </p>
          ) : null}
          {noApp ? (
            <p
              role="alert"
              className="text-caption text-destructive"
              data-testid="create-flow-noapp"
            >
              {t("tenants.companyFlows.create.noApp")}{" "}
              <Link
                to="/tenants/$tenantId"
                params={{ tenantId: tid }}
                search={{ tab: "apps" }}
                className="underline"
                onClick={() => onOpenChange(false)}
              >
                {t("tenants.companyFlows.create.openApps")}
              </Link>
            </p>
          ) : null}
          {apps.length > 1 ? (
            <div className="space-y-1">
              <Label htmlFor="create-flow-app">{t("tenants.companyFlows.create.appFor")}</Label>
              <Select value={app} onValueChange={setApp}>
                <SelectTrigger id="create-flow-app">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((a) => (
                    <SelectItem key={a} value={a}>
                      {appName(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="create-flow-name">{t("tenants.companyFlows.create.name")}</Label>
            <Input
              id="create-flow-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {err ? (
            <p role="alert" className="text-caption text-destructive">
              {err}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!ready || op.isPending}
            onClick={submit}
            data-testid="create-flow-submit"
          >
            {t("tenants.companyFlows.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
