// ADM-FR-32 · ADM-FR-36 · F4 · hộp thoại "Cấp {feature} cho group": chọn group (group của user xếp đầu) → Cấp (một batch).
import type { FeatureMini } from "@ai/contracts";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pickLocalized } from "@/lib/localized";
import { useGrantToGroup } from "../../hooks/use-grant-to-group";

type Props = {
  tenantId: string;
  feature: FeatureMini;
  userGroupIds: string[];
  onClose: () => void;
};

export function GrantToGroupDialog({ tenantId, feature, userGroupIds, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const g = useGrantToGroup({ tenantId, feature, userGroupIds, onDone: onClose });
  const name = pickLocalized(feature.name, i18n.language);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("access.grant.title", { feature: name })}</DialogTitle>
          <DialogDescription>{t("access.grant.hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="grant-group">{t("access.grant.group")}</Label>
          <Select value={g.groupId} onValueChange={g.setGroupId}>
            <SelectTrigger
              id="grant-group"
              aria-label={t("access.grant.group")}
              aria-invalid={g.missing || undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {g.options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {pickLocalized(o.name, i18n.language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {g.missing ? (
            <p role="alert" className="text-caption text-destructive">
              {t("access.grant.groupRequired")}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={g.pending} onClick={() => void g.submit()}>
            {t("access.grant.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
