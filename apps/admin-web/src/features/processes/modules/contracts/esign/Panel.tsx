// CR-125 · m6a · MOD-FR-08: panel RIÊNG của Ký số, đăng ký ở panelRegistry (chuyển nguyên từ NodeConfigPanel, không đổi giao diện).
// CR-122 · U2f · FLOW2-FR-25: panel cấu hình RIÊNG của node module (manifest `node.config { stage, options_path }`) — hiện cho Ký số:
// nhà cung cấp, người ký công ty (≤ 3), đối tác ký, thứ tự, hạn, nhắc. Ô trống ⇒ "Theo cài đặt ứng dụng". Lựa chọn lấy từ `options_path`;
// kiểm bằng `<…>/node-config/check` mỗi khi cấu hình đổi, lỗi hiện tại ô (`field`). Tổng quát theo manifest; bộ mã hoá ở `lib/node-config.ts`.
import { isApproverGroup } from "@ai/contracts/groups";
import {
  ESIGN_NODE_ORDERS,
  type ESignNodeCheckOut,
  type ESignNodeOptionsOut,
  type EsignNodeConfig,
  esignConfigIssues,
} from "@ai/contracts/pack-contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useUserList } from "@/features/users/api";
import { useSession } from "@/lib/auth/use-session";
import { ApiError, api } from "@/lib/http";
import { hubUrl } from "@/lib/hub";
import { SelectField, TextField } from "../../../components/editor/Fields";
import { EsignSettingsLink } from "../../../components/flow/EsignSettingsLink";
import { useFlowCtx } from "../../../components/flow/flow-ctx";
import { draftClusterOf } from "../../../lib/module-cluster";
import { checkPathOf, constArgs, ESIGN_CODEC, withConfigArgs } from "../../../lib/node-config";
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

const sid = (s: { kind: string; id: string }) => `${s.kind}:${s.id}`;

type Choice = { kind: "user" | "group"; id: string; label: string };

/** Chọn người ký công ty (người/Group), tối đa `max`; trống ⇒ "Theo cài đặt ứng dụng". */
function SignerPicker(p: {
  label: string;
  signers: readonly { kind: string; id: string }[];
  choices: readonly Choice[];
  max: number;
  readOnly: boolean;
  placeholder: string;
  error: string | undefined;
  onToggle: (c: Choice) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{p.label}</Label>
      {p.signers.length === 0 ? (
        <p className="m-0 text-caption text-muted-foreground">{p.placeholder}</p>
      ) : null}
      <ul className="m-0 grid max-h-36 list-none grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto p-0">
        {p.choices.map((c) => {
          const on = p.signers.some((x) => sid(x) === sid(c));
          return (
            <li key={sid(c)}>
              <Label className="flex items-center gap-1.5 font-normal">
                <Checkbox
                  checked={on}
                  disabled={p.readOnly || (!on && p.signers.length >= p.max)}
                  onCheckedChange={() => p.onToggle(c)}
                />
                <span className="truncate">{c.label}</span>
              </Label>
            </li>
          );
        })}
      </ul>
      {p.error ? (
        <p role="alert" className="m-0 text-caption text-destructive">
          {p.error}
        </p>
      ) : null}
    </div>
  );
}
/** CR-125 · m4 · MOD-FR-11: node không chọn nhà cung cấp — người ký chọn cách ký lúc ký; cách khả dụng đặt ở Cài đặt › Ký số. */
function SignChoiceLine() {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 text-body"
      data-testid="esign-provider-line"
    >
      <span>{t(`${K}signChooses`)}</span>
      <EsignSettingsLink />
    </div>
  );
}

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
    hasCfg && !!opts.data?.enabled,
  );
  const people = useUserList(
    { ...(flow?.tenantId ? { tenantId: flow.tenantId } : {}), q: "", offset: 0 },
    !!flow?.tenantId,
  );
  if (!conf) return null;
  // lỗi theo ô: kiểm trực tiếp (`node-config/check`) hoặc lỗi lưu của server (`stages.<i>.executor.args.<khoá>`)
  const issue = (f: string) => {
    const own = esignConfigIssues(cfg).find((x) => x.field === f); // CEO-review #2 · luật chung, hiện ngay tại ô
    if (own && !(f === "company_signers" && opts.data?.default_signers))
      return t(`${K}err.${own.code}`);
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
  if (!o.enabled)
    return (
      <p role="status" className="text-caption text-warning" data-testid="esign-disabled">
        {t(`${K}disabled`)}
      </p>
    );
  const dflt = t(`${K}default`);
  const signers = cfg.company_signers ?? [];
  const toggle = (s: { kind: "user" | "group"; id: string }) => {
    const on = signers.some((x) => sid(x) === sid(s));
    const next = on ? signers.filter((x) => sid(x) !== sid(s)) : [...signers, s];
    set({ company_signers: next.length > 0 ? next.slice(0, o.limits.signers_max) : undefined });
  };
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
  const num = (v: number | undefined) => (v === undefined ? "" : String(v));
  const toNum = (v: string) => (v.trim() === "" ? undefined : Math.trunc(Number(v)));
  return (
    <fieldset className="space-y-3" data-testid="node-config" aria-label={t(`${K}title`)}>
      <SignChoiceLine />
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
      <SignerPicker
        label={t(`${K}signers`, { max: o.limits.signers_max })}
        signers={signers}
        choices={choices}
        max={o.limits.signers_max}
        readOnly={readOnly}
        placeholder={o.default_signers ? t(`${K}defaultSigners`, o.default_signers) : dflt}
        error={issue("company_signers")}
        onToggle={toggle}
      />{" "}
    </fieldset>
  );
}
