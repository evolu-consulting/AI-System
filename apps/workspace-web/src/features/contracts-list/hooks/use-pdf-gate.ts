// CR-125 · UX H6 · CR-135 Q4 · công ty đang ký số (bật + có nhà cung cấp; cùng luật với hub) ⇒ chỉ nhận PDF: lọc tệp vừa chọn/thả, giữ tên tệp bị loại để báo cách khắc phục.
import { esignRequiresPdf } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useEsignSettings } from "~/features/contract-esign/hooks/use-esign-settings";
import { splitForEsign } from "../lib/pdf-gate";

export function usePdfGate(accept: (files: File[]) => void) {
  const esign = useEsignSettings(() => undefined);
  const [notPdf, setNotPdf] = useState<string[]>([]);
  const pick = (picked: File[]) => {
    const r = splitForEsign(picked, esign.q.data ? esignRequiresPdf(esign.q.data) : false);
    setNotPdf(r.notPdf);
    if (r.ok.length) accept(r.ok);
  };
  return { pick, notPdf };
}
