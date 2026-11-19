// CR-181 · s12 · chưa có chữ ký: tạo ngay tại màn ký (SignatureCreator trong hộp thoại), lưu rồi ký tiếp.
import type { MySignatureView } from "@ai/contracts/signature";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ai/web-kit/ui/kit/dialog";
import { useTranslation } from "react-i18next";
import { SignatureCreator } from "~/features/my-signature/components/SignatureCreator";
import type { Method } from "~/features/my-signature/lib/signature-image";

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });

export function CreateSignatureDialog(p: {
  open: boolean;
  view: MySignatureView;
  person: string;
  onSave: (v: { kind: "main"; method: Method; png: string; caption: string | null }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const s = p.view.settings;
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent data-testid="sign-create" closeLabel={t("contracts.docsign.close")}>
        <DialogHeader>
          <DialogTitle>{t("contracts.docsign.create.title")}</DialogTitle>
        </DialogHeader>
        <SignatureCreator
          methods={[...s.methods]}
          ink={s.ink}
          caption={p.view.profile_caption ?? ""}
          person={{ name: p.person }}
          allowLater={false}
          step="main"
          onSave={async (png, method, caption) =>
            p.onSave({
              kind: "main",
              method,
              caption,
              png: (await blobToDataUrl(png)).replace(/^data:[^,]*,/, ""),
            })
          }
        />
      </DialogContent>
    </Dialog>
  );
}
