// CR-181 · s4 · luồng tạo chữ ký dùng chung cho màn chặn và hộp thoại «Tạo chữ ký mới»: chính ⇒ (nếu `initials = own`) chữ ký tắt.
import type { MySignatureView, SignatureKind } from "@ai/contracts/signature";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { firstStep, needsInitialsAfterMain } from "../lib/gate";
import type { Method } from "../lib/signature-image";
import { SignatureCreator } from "./SignatureCreator";

export type CreateFlowProps = {
  view: MySignatureView;
  person: { name: string; title?: string };
  /** Lưu một chữ ký; ném lỗi nếu thất bại (luồng ở lại bước hiện tại). */
  save: (
    kind: SignatureKind,
    png: Blob,
    method: Method,
    caption: string | null,
  ) => Promise<unknown>;
  onDone: () => void;
  onFail: () => void;
  allowLater?: boolean;
  onLater?: () => void;
  /** Nhãn nút lưu ở bước cuối (mặc định «Lưu chữ ký»). */
  finalLabel?: { main?: string; initials?: string };
};

export function CreateFlow(p: CreateFlowProps) {
  const { t } = useTranslation();
  const s = p.view.settings;
  const [step, setStep] = useState<"main" | "initials">(() => firstStep(p.view));
  const own = needsInitialsAfterMain(s);
  const onSave = async (png: Blob, method: Method, caption: string | null) => {
    try {
      await p.save(step, png, method, caption);
    } catch {
      p.onFail();
      return;
    }
    if (step === "main" && own) setStep("initials");
    else p.onDone();
  };
  const last = step === "initials" || !own;
  return (
    <SignatureCreator
      key={step}
      methods={s.methods}
      ink={s.ink}
      caption={step === "main" ? (p.view.profile_caption ?? "") : undefined}
      person={p.person}
      allowLater={p.allowLater === true}
      onLater={p.onLater}
      step={step}
      saveLabel={
        last
          ? step === "initials"
            ? p.finalLabel?.initials
            : p.finalLabel?.main
          : t("contracts.mySig.save")
      }
      onSave={onSave}
    />
  );
}
