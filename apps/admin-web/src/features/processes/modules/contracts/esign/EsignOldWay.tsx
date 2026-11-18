// CR-182 · công ty TẮT ký trên tài liệu ⇒ bước Ký chạy cách cũ: «Ký qua» + «Người ký phía công ty» (CR-146b). Trình bày thuần, không gọi API.
import {
  ESIGN_NODE_ONDOC,
  ESIGN_NODE_UPLOAD,
  type ESignNodeOptionsOut,
  type EsignNodeConfig,
} from "@ai/contracts/pack-contracts";
import { Checkbox } from "@ai/web-kit/ui/kit/checkbox";
import { Label } from "@ai/web-kit/ui/kit/label";
import { useTranslation } from "react-i18next";
import { SelectField } from "../../../components/editor/Fields";

const K = "process.admin.flow.esign.";
/** Giá trị đại diện «chưa chọn» (Radix Select không nhận value rỗng). */
const DEFAULT = "default";
export type SignerChoice = { kind: "user" | "group"; id: string; label: string };
const sid = (s: { kind: string; id: string }) => `${s.kind}:${s.id}`;

type Props = {
  uid: string;
  cfg: EsignNodeConfig;
  opts: ESignNodeOptionsOut;
  choices: readonly SignerChoice[];
  readOnly: boolean;
  issue: (field: string) => string | undefined;
  set: (patch: Partial<EsignNodeConfig>) => void;
};

export function EsignOldWay(p: Props) {
  const { t } = useTranslation();
  const { cfg, opts: o } = p;
  const signers = cfg.company_signers ?? [];
  const max = o.limits.signers_max;
  const toggle = (c: SignerChoice) => {
    const on = signers.some((x) => sid(x) === sid(c));
    const next = on ? signers.filter((x) => sid(x) !== sid(c)) : [...signers, c];
    p.set({
      company_signers:
        next.length > 0 ? next.slice(0, max).map(({ kind, id }) => ({ kind, id })) : undefined,
    });
  };
  const err = p.issue("company_signers");
  return (
    <div className="space-y-3" data-testid="esign-old-way">
      <SelectField
        id={`${p.uid}-provider`}
        label={t(`${K}provider`)}
        value={cfg.provider ?? DEFAULT}
        readOnly={p.readOnly}
        error={p.issue("provider")}
        options={[
          { value: DEFAULT, label: t(`${K}providerPick`) },
          ...o.providers.map((x) => ({ value: x.key, label: x.label })),
          { value: ESIGN_NODE_UPLOAD, label: t(`${K}providerUpload`) },
          { value: ESIGN_NODE_ONDOC, label: t(`${K}providerOnDoc`) },
        ]}
        onChange={(v) => p.set({ provider: v === DEFAULT ? undefined : v })}
      />
      <div className="space-y-1.5">
        <Label>{t(`${K}signers`, { max })}</Label>
        {signers.length === 0 ? (
          <p className="m-0 text-caption text-muted-foreground">{t(`${K}signersPick`)}</p>
        ) : null}
        <ul className="m-0 grid max-h-36 list-none grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto p-0">
          {p.choices.map((c) => {
            const on = signers.some((x) => sid(x) === sid(c));
            return (
              <li key={sid(c)}>
                <Label className="flex items-center gap-1.5 font-normal">
                  <Checkbox
                    checked={on}
                    disabled={p.readOnly || (!on && signers.length >= max)}
                    onCheckedChange={() => toggle(c)}
                  />
                  <span className="truncate">{c.label}</span>
                </Label>
              </li>
            );
          })}
        </ul>
        {err ? (
          <p role="alert" className="m-0 text-caption text-destructive">
            {err}
          </p>
        ) : null}
      </div>
    </div>
  );
}
