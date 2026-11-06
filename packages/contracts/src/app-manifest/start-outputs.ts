// CR-122 · A · FLOW2-FR-26 · đầu ra của node Bắt đầu khi = bản ghi của sự kiện (`record`) + mọi dữ kiện (`facts`). Có ở MỌI bước sau
// (flow bắt đầu từ một HĐ ⇒ mọi bước biết đó là HĐ nào). Thuần — trình sửa, kiểm cạnh, cầu nối AI và lúc mở lượt dùng chung.
import type { AppEventDecl, AppNodeIo } from "./manifest";

/** Đầu ra của Bắt đầu khi: `record` (kiểu chuỗi) + facts, đều có nhãn vi/en (vắng ⇒ khoá). */
export function startOutputsOf(ev: AppEventDecl | undefined): AppNodeIo[] {
  if (!ev) return [];
  const out: AppNodeIo[] = ev.record
    ? [{ key: ev.record.key, type: "string", required: false, label: ev.record.label }]
    : [];
  for (const f of ev.facts)
    if (!out.some((o) => o.key === f.key))
      out.push({
        key: f.key,
        type: f.type,
        required: false,
        label: { vi: f.label || f.key, en: f.label_en ?? (f.label || f.key) },
      });
  return out;
}

type RunInput = { key: string; type: "text" | "number"; text?: string; value?: string };

/**
 * Input của lượt khi mở từ sự kiện: `record` (= `ref`) + dữ kiện lúc sự kiện (snapshot). Chỉ giá trị đơn (chuỗi/số/đúng-sai);
 * danh sách nối bằng ", "; trống/null bỏ. Khoá đã có trong `existing` (input khai rõ) thắng.
 */
export function recordInputsOf(
  ev: AppEventDecl | undefined,
  ref: string,
  facts: Readonly<Record<string, unknown>>,
  existing: readonly string[] = [],
): RunInput[] {
  if (!ev) return [];
  const seen = new Set(existing);
  const out: RunInput[] = [];
  const add = (key: string, v: unknown) => {
    if (seen.has(key) || v === null || v === undefined || v === "") return;
    seen.add(key);
    if (typeof v === "number" && Number.isFinite(v))
      out.push({ key, type: "number", value: String(v) });
    else if (typeof v === "string" || typeof v === "boolean")
      out.push({ key, type: "text", text: String(v) });
    else if (Array.isArray(v) && v.length > 0)
      out.push({ key, type: "text", text: v.map(String).join(", ") });
  };
  if (ev.record) add(ev.record.key, ref);
  for (const f of ev.facts) add(f.key, facts[f.key]);
  return out;
}
