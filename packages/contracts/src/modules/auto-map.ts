// CR-125 · m4 · MOD-FR-12 · tự nối đầu vào của node: MỘT hàm thuần dùng cho trình sửa (lúc thêm node) và kiểm lúc lưu.
// Đầu vào chỉ có ĐÚNG MỘT nguồn (cùng khoá + cùng kiểu) ⇒ nối luôn; nhiều nguồn hoặc không có ⇒ hỏi, bằng câu nghiệp vụ + cách khắc phục.
import type { AppNodeIo } from "../app-manifest/manifest";

/** Một nguồn có sẵn tại chỗ đặt node: đầu ra của "Bắt đầu khi" hoặc của bước trước. */
export type MapSource = {
  /** Định danh nguồn (để nối): khoá đầu ra; trùng khoá ở hai bước thì khác `id`. */
  id: string;
  key: string;
  type: string;
  from: "start" | "step";
};

export type MapAsk = {
  key: string;
  reason: "none" | "many";
  /** Câu nghiệp vụ, có cách khắc phục. */
  message: string;
  sources: string[];
};

export type AutoMapOut = {
  /** Đầu vào đã nối (đúng một nguồn): `source` = `MapSource.id`. */
  bound: { key: string; source: string; from: MapSource["from"] }[];
  /** Đầu vào BẮT BUỘC chưa nối được: nhiều nguồn hoặc không có nguồn. */
  ask: MapAsk[];
};

type Lang = "vi" | "en";
const labelOf = (io: AppNodeIo, lang: Lang): string => {
  const l = io.label?.[lang]?.trim();
  return l ? l : io.key;
};

/** Câu hỏi cho một đầu vào chưa nối được (dùng chung trình sửa + kiểm lúc lưu). */
export function mapAskMessage(
  node: string,
  io: AppNodeIo,
  reason: MapAsk["reason"],
  lang: Lang = "vi",
): string {
  const what = labelOf(io, lang);
  if (reason === "many")
    return lang === "vi"
      ? `Bước «${node}» có nhiều nguồn cho «${what}» — chọn một nguồn.`
      : `«${node}» has several sources for «${what}» — pick one.`;
  const fix = io.fix?.[lang]?.trim();
  return lang === "vi"
    ? `Bước «${node}» cần «${what}» — ${fix ?? `thêm bước tạo «${what}» trước.`}`
    : `«${node}» needs «${what}» — ${fix ?? `add a step that provides «${what}» first.`}`;
}

/** Nối tự động: mỗi đầu vào có đúng một nguồn cùng khoá + kiểu ⇒ `bound`; đầu vào bắt buộc 0 hoặc ≥ 2 nguồn ⇒ `ask`. O(đầu vào × nguồn). */
export function autoMapInputs(
  inputs: readonly AppNodeIo[],
  sources: readonly MapSource[],
  opts: { node: string; lang?: Lang },
): AutoMapOut {
  const out: AutoMapOut = { bound: [], ask: [] };
  for (const io of inputs) {
    const hit = sources.filter((s) => s.key === io.key && s.type === io.type);
    if (hit.length === 1 && hit[0]) {
      out.bound.push({ key: io.key, source: hit[0].id, from: hit[0].from });
    } else if (io.required) {
      const reason = hit.length === 0 ? "none" : "many";
      out.ask.push({
        key: io.key,
        reason,
        message: mapAskMessage(opts.node, io, reason, opts.lang),
        sources: hit.map((s) => s.id),
      });
    }
  }
  return out;
}
