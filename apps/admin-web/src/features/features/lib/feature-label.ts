// CR-111 · tên + mô tả dễ hiểu của feature: key trong registry → i18n `featmeta.f.<key>.*`; key lạ → tên/mô tả gốc từ server.
import type { Translate } from "@/lib/format";
import { type LocalizedText, pickLocalized } from "@/lib/localized";
import { isRegistered } from "./feature-meta";

export function featureText(
  tr: Translate,
  lang: string,
  f: { key: string; name: LocalizedText; description?: { vi?: string; en?: string } },
): { name: string; desc: string } {
  if (isRegistered(f.key)) {
    return { name: tr(`featmeta.f.${f.key}.name`), desc: tr(`featmeta.f.${f.key}.desc`) };
  }
  const d = f.description;
  return {
    name: pickLocalized(f.name, lang) || f.key,
    desc: d ? pickLocalized({ vi: d.vi ?? "", en: d.en }, lang) : "",
  };
}
