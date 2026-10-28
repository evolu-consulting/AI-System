// Chủ quản thấy raw; khoảng bị che với user ngoài được tô (`hits`). User ngoài không có hits ⇒ in nguyên văn (đã che).
import type { ContentHit } from "@ai/contracts/community";

export function segments(
  text: string,
  hits: ContentHit[] | undefined,
  field: ContentHit["field"],
): { t: string; hit: boolean }[] {
  const hs = (hits ?? []).filter((h) => h.field === field).sort((a, b) => a.start - b.start);
  const out: { t: string; hit: boolean }[] = [];
  let pos = 0;
  for (const h of hs) {
    if (h.start < pos) continue;
    if (h.start > pos) out.push({ t: text.slice(pos, h.start), hit: false });
    out.push({ t: text.slice(h.start, h.end), hit: true });
    pos = h.end;
  }
  if (pos < text.length) out.push({ t: text.slice(pos), hit: false });
  return out;
}

export function Highlighted({
  text,
  hits,
  field,
}: {
  text: string;
  hits?: ContentHit[] | undefined;
  field: ContentHit["field"];
}) {
  return (
    <>
      {segments(text, hits, field).map((s, i) =>
        s.hit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: đoạn tĩnh theo vị trí
          <mark key={i} className="hl" title="Đối tác thấy phần này đã bị che">
            {s.t}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: đoạn tĩnh theo vị trí
          <span key={i}>{s.t}</span>
        ),
      )}
    </>
  );
}
