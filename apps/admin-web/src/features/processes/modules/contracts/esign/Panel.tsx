// CR-125 · m6a · MOD-FR-08: panel RIÊNG của Ký số, đăng ký ở panelRegistry (chuyển nguyên từ NodeConfigPanel, không đổi giao diện).
// CR-122 · U2f · FLOW2-FR-25: panel cấu hình RIÊNG của node module (manifest `node.config { stage, options_path }`) — hiện cho Ký số:
// nhà cung cấp, người ký công ty (≤ 3), đối tác ký, thứ tự, hạn, nhắc. Ô trống ⇒ "Theo cài đặt ứng dụng". Lựa chọn lấy từ `options_path`;
// kiểm bằng `<…>/node-config/check` mỗi khi cấu hình đổi, lỗi hiện tại ô (`field`). Tổng quát theo manifest; bộ mã hoá ở `lib/node-config.ts`.
import { isApproverGroup } from "@ai/contracts/groups";
import {
  ESIGN_NODE_ONDOC,
  ESIGN_NODE_ORDERS,
  ESIGN_NODE_UPLOAD,
  type ESignNodeCheckOut,
  type ESignNodeOptionsOut,
  type EsignNodeConfig,
  esignConfigIssues,
} from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Label } from "@ai/web-kit/ui/kit/label";
import { Switch } from "@ai/web-kit/ui/kit/switch";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUserList } from "@/features/users/api";
import { useSession } from "@/lib/auth/use-session";
import { ApiError, api } from "@/lib/http";
import { hubUrl } from "@/lib/hub";
import { SelectField, TextField } from "../../../components/editor/Fields";
import { RoleField } from "../../../components/editor/RoleField";
import { EsignSettingsLink } from "../../../components/flow/EsignSettingsLink";
import { useFlowCtx } from "../../../components/flow/flow-ctx";
import { esignRoleUi } from "../../../lib/esign-role-ui";
import { draftClusterOf } from "../../../lib/module-cluster";
import { checkPathOf, constArgs, ESIGN_CODEC, withConfigArgs } from "../../../lib/node-config";
import { DEFAULT_SIGNER_ROLE, rolesOfStages } from "../../../lib/role-pick";
import type { StageRole } from "../../../lib/role-types";
import type { NodePanelProps } from "../../panel-registry";

/** Giá trị đại diện "Theo cài đặt ứng dụng" (Radix Select không nhận value rỗng). */
const DEFAULT = "default";
const K = "process.admin.flow.esign.";
const url = (p: string): string => hubUrl(p) ?? p;

/** CR-127 · EO2: admin nền tảng soạn cho công ty đích ⇒ gửi `?tenant_id=`; mẫu thư viện (không công ty) ⇒ không gửi. */
const withTenant = (path: string, tenantId: string | undefined): string =>
  tenantId && path ? `${path}?tenant_id=${encodeURIComponent(tenantId)}` : path;

function useOptions(path: string) {
  return useQuery({
    queryKey: ["node-options", path] as const,
    retry: false,
    staleTime: 60_000,
    queryFn: () => api<ESignNodeOptionsOut>(url(path)),
  });
}

function useCheck(path: string, cfg: EsignNodeConfig, on: boolean) {
  return useQuery({
    queryKey: ["node-check", path, cfg] as const,
    enabled: on,
    retry: false,
    queryFn: () => api<ESignNodeCheckOut>(url(path), { method: "POST", body: cfg }),
  });
}

/** CR-182 · R3 · bước Ký mới chưa có vai và chưa có cấu hình cũ ⇒ mặc định vai «Người ký hợp đồng». */
const isLegacy = (c: EsignNodeConfig): boolean => !!c.provider || !!c.company_signers?.length;

const sid = (s: { kind: string; id: string }) => `${s.kind}:${s.id}`;

type Choice = { kind: "user" | "group"; id: string; label: string };

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 · U2 — form nhiều ô, tách ở đợt dọn sau
export function EsignPanel(p: NodePanelProps) {
  const { t } = useTranslation();
  const flow = useFlowCtx();
  const isPlatform = useSession((x) => x.me?.role) === "platform_admin";
  const { stage, readOnly, node } = p;
  const conf = node.config;
  const codec = ESIGN_CODEC;
  const cfg = codec.decode(constArgs(stage.tool, codec.keys));
  const opts = useOptions(withTenant(conf?.options_path ?? "", flow?.tenantId));
  const hasCfg = Object.keys(cfg).length > 0;
  const check = useCheck(
    withTenant(checkPathOf(conf?.options_path ?? ""), flow?.tenantId),
    cfg,
    hasCfg,
  );
  const people = useUserList(
    { ...(flow?.tenantId ? { tenantId: flow.tenantId } : {}), q: "", offset: 0 },
    !!flow?.tenantId,
  );
  // CR-182 · đang gõ vai MỚI (khoá chưa sinh được) ⇒ không tự điền vai mặc định đè lên.
  const [fresh, setFresh] = useState<StageRole | null>(null);
  // CR-182 · chỉ công ty BẬT ký trên tài liệu mới tự gán vai; công ty tắt ⇒ bước mới giữ cách cũ («Ký qua» + người ký công ty).
  const ui = esignRoleUi(cfg, opts.data?.on_doc_enabled);
  const needDefault = !readOnly && !fresh && ui.autoRole;
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi bước Ký còn trống vai
  useEffect(() => {
    if (!needDefault) return;
    const next = { ...cfg, signer_role: DEFAULT_SIGNER_ROLE.key };
    p.onChange({ tool: withConfigArgs(stage.tool, codec.keys, codec.encode(next)) });
  }, [needDefault]);
  if (!conf) return null;
  // lỗi theo ô: kiểm trực tiếp (`node-config/check`) hoặc lỗi lưu của server (`stages.<i>.executor.args.<khoá>`)
  const issue = (f: string) => {
    const own = esignConfigIssues(cfg).find((x) => x.field === f); // CR-146b · luật chung (Ký qua + người ký bắt buộc), hiện ngay tại ô
    if (own) return t(`${K}err.${own.code}`);
    const i = check.data?.issues.find((x) => x.field === f);
    if (i) return t(`${K}err.${i.code}`, { defaultValue: i.code });
    const saved = p.errors[`stages.${p.index}.executor.args.${f}`];
    return saved ? t(saved) : undefined;
  };
  const set = (patch: Partial<EsignNodeConfig>) => {
    const next = { ...cfg, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const c = next as EsignNodeConfig;
    const own = { tool: withConfigArgs(stage.tool, codec.keys, codec.encode(c)) };
    // hạn ký ⇒ đặt luôn giờ chờ của stage chờ đi kèm (hợp đồng E5)
    const h = codec.waitH(c);
    // đúng cụm của node này (nhiều node Ký số trong một flow ⇒ không đụng cụm khác)
    const cl = draftClusterOf(p.all, p.index);
    const wait = p.all.find(
      (s, j) => !!cl && j >= cl.start && j < cl.end && s.executor === "wait_event",
    );
    // hai stage đổi trong MỘT lần (không để lần sau ghi đè lần trước)
    if (h !== null && wait && flow?.patchStages)
      flow.patchStages([
        { uid: stage.uid, patch: own },
        { uid: wait.uid, patch: { wait: { ...wait.wait, timeoutH: String(h) } } },
      ]);
    else p.onChange(own);
  };
  if (opts.isPending) return <p className="text-caption text-muted-foreground">…</p>;
  if (opts.error instanceof ApiError && (opts.error.code as string) === "PACK_DISABLED")
    return (
      <p role="status" className="text-caption text-warning" data-testid="esign-pack-off">
        {isPlatform ? t(`${K}packOffPlatform`) : t(`${K}packOff`)}{" "}
        {flow?.tenantId && !isPlatform ? (
          <Link
            to="/tenants/$tenantId"
            params={{ tenantId: flow.tenantId }}
            search={{ tab: "apps" }}
            className="underline"
          >
            {t(`${K}openApps`)}
          </Link>
        ) : null}
      </p>
    );
  if (opts.isError || !opts.data)
    return <p className="text-caption text-muted-foreground">{t(`${K}unavailable`)}</p>;
  const o = opts.data;
  const dflt = t(`${K}default`);
  const signers = cfg.company_signers ?? [];
  const choices = [
    ...o.groups.filter(isApproverGroup).map((g) => ({
      kind: "group" as const,
      id: g.id,
      label: `${t(`${K}group`)}: ${g.name}`,
    })),
    ...(people.data?.items ?? []).map((u) => ({
      kind: "user" as const,
      id: u.id,
      label: u.display_name ?? u.username,
    })),
  ];
  const roles = rolesOfStages(p.all);
  // CR-182 · vai người ký: chọn vai đã có (gồm vai mặc định) hoặc NHẬP vai mới; nhãn lưu ở `signer_role_label`.
  const existing = [
    ...(roles.some((r) => r.key === DEFAULT_SIGNER_ROLE.key) ? [] : [DEFAULT_SIGNER_ROLE]),
    ...roles,
  ];
  const roleValue = fresh
    ? fresh
    : cfg.signer_role
      ? {
          key: cfg.signer_role,
          label:
            cfg.signer_role_label ??
            existing.find((r) => r.key === cfg.signer_role)?.label ??
            cfg.signer_role,
        }
      : undefined;
  const providerName =
    cfg.provider === ESIGN_NODE_UPLOAD
      ? t(`${K}providerUpload`)
      : cfg.provider === ESIGN_NODE_ONDOC
        ? t(`${K}providerOnDoc`)
        : (o.providers.find((x) => x.key === cfg.provider)?.label ?? cfg.provider);
  const legacyText = [
    providerName,
    signers.length > 0
      ? signers.map((x) => choices.find((c) => sid(c) === sid(x))?.label ?? x.id).join(", ")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const num = (v: number | undefined) => (v === undefined ? "" : String(v));
  const toNum = (v: string) => (v.trim() === "" ? undefined : Math.trunc(Number(v)));
  return (
    <fieldset className="space-y-3" data-testid="node-config" aria-label={t(`${K}title`)}>
      <RoleField
        id={`${stage.uid}-signer-role`}
        value={roleValue}
        existing={existing}
        readOnly={readOnly}
        error={issue("signer_role") ?? issue("company_signers")}
        onChange={(r) => {
          setFresh(r.key === "" ? r : null);
          set({
            signer_role: r.key === "" ? undefined : r.key,
            signer_role_label: r.key === "" || r.label.trim() === "" ? undefined : r.label.trim(),
          });
        }}
      />
      <Label className="flex items-center gap-2 font-normal" htmlFor={`${stage.uid}-need-digital`}>
        <Switch
          id={`${stage.uid}-need-digital`}
          checked={cfg.need_digital === true}
          disabled={readOnly}
          onCheckedChange={(v) => set({ need_digital: v ? true : undefined })}
        />
        {t(`${K}needDigital`)}
      </Label>
      {issue("need_digital") ? (
        <p role="alert" className="m-0 text-caption text-destructive">
          {issue("need_digital")}
        </p>
      ) : null}
      {isLegacy(cfg) ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-caption text-muted-foreground"
          data-testid="esign-legacy"
        >
          <span>{t(`${K}legacy`, { what: legacyText })}</span>
          {readOnly ? null : ui.canSwitch ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="esign-legacy-switch"
              // giữ «Ký qua» + người ký cũ (đường lùi khi công ty tắt lại ký trên tài liệu): lúc chạy vai thắng khi công ty bật
              onClick={() => set({ signer_role: cfg.signer_role ?? DEFAULT_SIGNER_ROLE.key })}
            >
              {t(`${K}legacySwitch`)}
            </Button>
          ) : (
            <span data-testid="esign-ondoc-off">{t(`${K}ondocOff`)}</span>
          )}
        </div>
      ) : null}
      {ui.blocked ? (
        <p role="alert" className="text-caption text-destructive" data-testid="esign-ondoc-blocked">
          {t(`${K}err.ONDOC_NOT_ENABLED`)}
        </p>
      ) : null}
      {o.enabled ? null : (
        <p role="status" className="text-caption text-warning" data-testid="esign-disabled">
          {t(`${K}disabled`)} <EsignSettingsLink />
        </p>
      )}
      <div className="grid grid-cols-2 items-start gap-3">
        <SelectField
          id={`${stage.uid}-order`}
          label={t(`${K}order`)}
          value={cfg.order ?? DEFAULT}
          readOnly={readOnly}
          error={issue("order")}
          options={[
            { value: DEFAULT, label: dflt },
            ...ESIGN_NODE_ORDERS.map((x) => ({ value: x, label: t(`${K}orders.${x}`) })),
          ]}
          onChange={(v) =>
            set({ order: v === DEFAULT ? undefined : (v as EsignNodeConfig["order"]) })
          }
        />
        <SelectField
          id={`${stage.uid}-partner`}
          error={issue("partner_signs")}
          label={t(`${K}partner`)}
          value={cfg.partner_signs === undefined ? DEFAULT : String(cfg.partner_signs)}
          readOnly={readOnly}
          options={[
            { value: DEFAULT, label: dflt },
            { value: "true", label: t(`${K}yes`) },
            { value: "false", label: t(`${K}no`) },
          ]}
          onChange={(v) => set({ partner_signs: v === DEFAULT ? undefined : v === "true" })}
        />
        <div />
        <TextField
          id={`${stage.uid}-due`}
          label={t(`${K}due`)}
          error={issue("due_days")}
          type="number"
          value={num(cfg.due_days)}
          placeholder={dflt}
          readOnly={readOnly}
          onChange={(v) => set({ due_days: toNum(v) })}
        />
        <TextField
          id={`${stage.uid}-remind`}
          label={t(`${K}remind`)}
          error={issue("remind_every_hours")}
          type="number"
          value={num(cfg.remind_every_hours)}
          placeholder={dflt}
          readOnly={readOnly}
          onChange={(v) => set({ remind_every_hours: toNum(v) })}
        />
      </div>
    </fieldset>
  );
}
