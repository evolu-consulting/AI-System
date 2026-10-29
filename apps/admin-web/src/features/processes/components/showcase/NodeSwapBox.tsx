// CR-103 · R4 fnr-showcase: ô "Đổi node" — minh hoạ R3 chỉ đọc (không lưu): chọn một giai đoạn của flow mẫu, mỗi loại node
// hiện kết quả `canSwap` (contracts, cùng hàm FE/BE dùng): đổi được, hoặc vì sao không (khác họ / mất field bước sau dùng).
import {
  type CanSwap,
  canSwap,
  type ExecutorKind,
  NODE_FAMILY_OF,
  type ProcessStageDef,
} from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { NODE_FAMILIES, swappable } from "../../lib/showcase";

const K = "process.admin.showcase.swap.";
type Props = { stages: readonly ProcessStageDef[] };
const isKind = (k: string): k is ExecutorKind => Object.hasOwn(NODE_FAMILY_OF, k);

function verdict(stages: readonly ProcessStageDef[], idx: number, kind: string): CanSwap | null {
  return isKind(kind) ? canSwap({ stages }, idx, kind) : null; // loại chưa có trong contract (vd `if` trước R2)
}

function KindBadge(p: {
  kind: string;
  cur: string | undefined;
  stages: readonly ProcessStageDef[];
  idx: number;
}) {
  const { t } = useTranslation();
  const v = p.kind === p.cur ? null : verdict(p.stages, p.idx, p.kind);
  const variant = p.kind === p.cur ? "info" : v?.ok ? "ok" : "outline";
  const note = v ? ` · ${v.ok ? t(`${K}can.ok`) : t(`${K}can.${v.reason}`)}` : "";
  return (
    <Badge variant={variant}>
      {p.kind}
      {note}
    </Badge>
  );
}
export function NodeSwapBox({ stages }: Props) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const cur = stages[idx]?.executor.kind;
  return (
    <div data-testid="showcase-swap" className="space-y-3">
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      <label className="flex items-center gap-2 text-label">
        {t(`${K}pick`)}
        <select
          className="h-8 rounded-md border border-input bg-background px-2"
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
        >
          {stages.map((s, i) => (
            <option key={s.key} value={i}>
              {s.name} ({s.executor.kind})
            </option>
          ))}
        </select>
      </label>
      <ul className="space-y-2">
        {NODE_FAMILIES.map((f) => (
          <li key={f.family} className="flex flex-wrap items-center gap-2">
            <strong className="min-w-24 text-label font-medium">
              {t(`${K}family.${f.family}`)}
            </strong>
            {f.kinds.map((k) => (
              <KindBadge key={k} kind={k} cur={cur} stages={stages} idx={idx} />
            ))}
            <span className="text-caption text-muted-foreground">
              {swappable(f.family) ? t(`${K}yes`) : t(`${K}no`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
