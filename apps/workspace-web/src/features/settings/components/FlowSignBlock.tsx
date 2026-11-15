// CR-146 · khối chỉ xem «Ký và đối tác của quy trình này» (đọc từ args bước Ký / Gửi đối tác của CHÍNH quy trình).
import { useTranslation } from "react-i18next";
import type { CurrentFlow } from "../lib/current-flow";

export function FlowSignBlock({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) =>
    t(`contracts.flow.current.signBlock.${s}`, o);
  const s = flow.sign;
  const lines: string[] = [];
  if (!s) lines.push(k("noEsign"));
  else {
    lines.push(
      s.signers.length === 0
        ? k("noSigners")
        : k("signers", {
            names: s.signers.map((x) => x.name ?? k("unnamed")).join(", "),
          }),
    );
    lines.push(
      s.partnerSigns === true
        ? k("partnerSigns")
        : s.partnerSigns === false
          ? k("partnerNoSign")
          : k("partnerAuto"),
    );
    if (s.order) lines.push(k(s.order));
  }
  lines.push(flow.partnerSend ? k("send") : k("noSend"));
  return (
    <section data-testid="flow-sign-block" className="mt-4 rounded-lg border border-rule p-3">
      <h3 className="mb-2 text-label font-semibold">{k("title")}</h3>
      <ul className="space-y-1 text-body">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}
