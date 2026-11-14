// CR-146 · «Bắt đầu khi» bằng chữ nghiệp vụ (không lộ mã/trường kỹ thuật). Luật CHỌN flow ở server (`match.rules.ts`); đây chỉ là chữ.
import type { FactCond, FactWhen } from "@ai/contracts/hub-admin";

type Tr = (key: string, o?: Record<string, unknown>) => string;
const SYM: Record<string, string> = { ge: "≥", gt: ">", le: "≤", lt: "<", eq: "=", ne: "≠" };
const K = "contracts.flow.current.cond";

const millions = (v: number) => String(Math.round((v / 1e6) * 100) / 100);
const list = (v: FactCond["value"]) => (Array.isArray(v) ? v : [v]).map(String);

function condText(c: FactCond, names: Readonly<Record<string, string>>, t: Tr): string {
  const op = SYM[c.op] ?? c.op;
  if (c.fact === "total_value" && typeof c.value === "number")
    return t(`${K}.value`, { op, v: millions(c.value) });
  if (c.fact === "deal")
    return t(`${K}.deal`, {
      v: list(c.value)
        .map((x) => t(`${K}.deals.${x}`))
        .join(", "),
    });
  if (c.fact === "importance")
    return t(`${K}.importance`, {
      v: list(c.value)
        .map((x) => t(`${K}.levels.${x}`))
        .join(", "),
    });
  if (c.fact === "new_partner") return t(c.value === false ? `${K}.oldPartner` : `${K}.newPartner`);
  if (/department|group/.test(c.fact))
    return t(`${K}.dept`, {
      v: list(c.value)
        .map((x) => names[x] ?? x)
        .join(", "),
    });
  return t(`${K}.other`, { fact: c.fact, op, v: list(c.value).join(", ") });
}

/** null/rỗng ⇒ «Mọi hợp đồng còn lại». */
export function whenText(
  w: FactWhen | null,
  names: Readonly<Record<string, string>>,
  t: Tr,
): string {
  if (!w || w.conds.length === 0) return t("contracts.flow.current.always");
  const j = (op: string) => t(`contracts.flow.current.${op === "or" ? "or" : "and"}`);
  const parts = w.conds.map((c) =>
    "fact" in c
      ? condText(c, names, t)
      : `(${c.conds.map((x) => condText(x, names, t)).join(j(c.op))})`,
  );
  return parts.join(j(w.op));
}
