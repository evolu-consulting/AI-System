// CR-105 · UX: hộp thoại Nhân bản — nhập TÊN (gợi ý "<tên> – bản mới"); ký hiệu tự sinh từ tên, đọc được, duy nhất (Hub báo trùng ⇒ thử hậu tố).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloneSuggestion, slugKey } from "../../lib/library-list";

export type CloneSource = { id: string; name: string };
type Props = {
  src: CloneSource | null;
  pending: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

export function CloneDialog({ src, pending, error, onSubmit, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: gợi ý lại tên mỗi khi mở cho một quy trình khác
  useEffect(() => {
    if (src) setName(cloneSuggestion(src.name));
  }, [src?.id]);
  const trimmed = name.trim();
  return (
    <Dialog open={src !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("process.admin.library.clone.title", { name: src?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("process.admin.library.clone.body")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="clone-name">{t("process.admin.library.clone.name")}</Label>
          <Input
            id="clone-name"
            value={name}
            maxLength={100}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && trimmed !== "" && !pending && onSubmit(trimmed)}
          />
          <p className="text-caption text-muted-foreground">
            {t("process.admin.library.clone.key", { key: slugKey(trimmed) })}
          </p>
          {error ? (
            <p role="alert" className="text-label text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button disabled={pending || trimmed === ""} onClick={() => onSubmit(trimmed)}>
            {t("process.admin.library.clone.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
