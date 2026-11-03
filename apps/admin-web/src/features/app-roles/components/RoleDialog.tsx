// CR-112 · ADM-FR-80 · hộp thoại "Tạo vai" / "Sửa vai" (tên + mức). Chỉ ghi vào bản nháp; lưu thật ở nút Lưu của trang.
import type { AppRoleLevel } from "@ai/contracts";
import { useId, useState } from "react";
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
import { LEVEL_KEY, LEVELS } from "../lib/levels";

export const NAME_MAX = 64;

type Props = {
  mode: "create" | "edit";
  appName: string;
  initial?: { name: string; level: AppRoleLevel };
  onSubmit: (v: { name: string; level: AppRoleLevel }) => void;
  onClose: () => void;
};

export function RoleDialog({ mode, appName, initial, onSubmit, onClose }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [level, setLevel] = useState<AppRoleLevel>(initial?.level ?? "read");
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= NAME_MAX;
  const submit = () => {
    if (!valid) return;
    onSubmit({ name: trimmed, level });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(mode === "create" ? "appRoles.dialog.createTitle" : "appRoles.dialog.editTitle", {
              app: appName,
            })}
          </DialogTitle>
          <DialogDescription>{t("appRoles.dialog.desc")}</DialogDescription>
        </DialogHeader>
        <form
          id={`${id}-form`}
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>{t("appRoles.dialog.name")}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={NAME_MAX}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-level`}>{t("appRoles.dialog.level")}</Label>
            <select
              id={`${id}-level`}
              value={level}
              onChange={(e) => setLevel(e.target.value as AppRoleLevel)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-body"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(LEVEL_KEY[l])}
                </option>
              ))}
            </select>
            <p className="text-caption text-muted-foreground">
              {t(`appRoles.dialog.levelHint.${level}`)}
            </p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={!valid}>
            {t(mode === "create" ? "appRoles.dialog.create" : "appRoles.dialog.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
