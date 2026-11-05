// CR-120 · cột "Khi nào chạy" của một dòng: việc của khe (vd "Duyệt hợp đồng") + điều kiện luật ("HĐ mua từ Phòng Kinh doanh").
import { useTranslation } from "react-i18next";
import { type FlowRow, ruleParts, SLOT_PURPOSE } from "../../lib/flows-view";

const k = (s: string) => `process.admin.flows.${s}`;

export function FlowWhenText({
  row,
  deptName,
}: {
  row: FlowRow;
  deptName: (id: string) => string;
}) {
  const { t } = useTranslation();
  const purposeKey = row.slot ? SLOT_PURPOSE[row.slot] : undefined;
  const purpose = purposeKey ? t(k(`purpose.${purposeKey}`)) : row.slot;
  const w = row.when;
  const rule = (r: Extract<typeof w, { kind: "rules" }>["rules"][number]): string => {
    const p = ruleParts(r, deptName);
    if (p.isDefault) return t(k("when.default"));
    const bits: string[] = [];
    if (p.kinds.length)
      bits.push(t(k("when.kinds"), { kinds: p.kinds.map((x) => t(k(`kind.${x}`))).join(", ") }));
    const names = [...p.depts, ...(p.unknown ? [t(k("when.deptsN"), { n: p.unknown })] : [])];
    if (names.length) bits.push(t(k("when.depts"), { names: names.join(", ") }));
    return bits.join(" ");
  };
  const body = w.kind === "rules" ? w.rules.map(rule).join("; ") : t(k(`when.${w.kind}`));
  return (
    <span className="text-caption text-muted-foreground" data-testid={`flows-when-${row.id}`}>
      {purpose ? `${purpose} · ` : ""}
      {body}
    </span>
  );
}
