// CR-112 · ADM-FR-80 · khối một ứng dụng của Phân quyền: bảng Vai | Mức | Người | Sửa + "Tạo vai" (vai mặc định chỉ đọc).
import { Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LEVEL_KEY, packNameKey, roleLabel } from "../lib/levels";
import type { RoleView } from "../lib/view";
import { IneffectiveBadge, LevelBadge } from "./LevelBadge";
import { RoleDialog } from "./RoleDialog";

type Props = {
  pack: string;
  roles: RoleView[];
  readOnly?: boolean;
  onCreate: (pack: string, name: string, level: RoleView["level"]) => void;
  onEdit: (ref: string, patch: { name: string; level: RoleView["level"] }) => void;
  onRemove: (ref: string) => void;
  onRestore: (ref: string) => void;
};

export function useAppName(pack: string): string {
  const { t } = useTranslation();
  const key = packNameKey(pack);
  return key ? t(key) : pack;
}

function RoleRow({
  role,
  readOnly,
  onEdit,
  onRemove,
  onRestore,
}: {
  role: RoleView;
  readOnly?: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  const { t, i18n } = useTranslation();
  const label = roleLabel(role, i18n.language);
  const name = "key" in label ? t(label.key) : label.text;
  const locked = role.isDefault;
  const busy = role.members > 0;
  return (
    <TableRow className={role.deleted ? "opacity-50" : undefined}>
      <TableCell>
        <span className={role.deleted ? "line-through" : "font-medium"}>{name}</span>{" "}
        {role.isDefault ? <StatusBadge tone="off">{t("appRoles.role.default")}</StatusBadge> : null}
        {role.isNew ? <StatusBadge tone="info">{t("appRoles.role.new")}</StatusBadge> : null}
        {role.edited ? <StatusBadge tone="info">{t("appRoles.role.edited")}</StatusBadge> : null}
        {role.deleted ? <StatusBadge tone="err">{t("appRoles.role.deleted")}</StatusBadge> : null}
      </TableCell>
      <TableCell className="space-x-1">
        <LevelBadge level={role.level} />
        {role.effective ? null : <IneffectiveBadge ceiling={role.ceiling} />}
      </TableCell>
      <TableCell>{t("appRoles.role.members", { count: role.members })}</TableCell>
      <TableCell className="text-right">
        {readOnly || locked ? null : role.deleted ? (
          <Button size="sm" variant="ghost" onClick={onRestore}>
            <Undo2 aria-hidden /> {t("appRoles.role.restore")}
          </Button>
        ) : (
          <span className="inline-flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("appRoles.role.editAria", { name })}
              onClick={onEdit}
            >
              <Pencil aria-hidden /> {t("appRoles.role.edit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("appRoles.role.deleteAria", { name })}
              disabled={busy}
              title={busy ? t("appRoles.role.deleteBlocked") : undefined}
              onClick={onRemove}
            >
              <Trash2 aria-hidden /> {t("appRoles.role.delete")}
            </Button>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function RoleBlock({ pack, roles, readOnly, onCreate, onEdit, onRemove, onRestore }: Props) {
  const { t } = useTranslation();
  const appName = useAppName(pack);
  const [dialog, setDialog] = useState<
    { ref: string; name: string; level: RoleView["level"] } | "create" | null
  >(null);
  const ceiling = roles[0]?.ceiling ?? null;
  return (
    <Card role="region" aria-label={t("appRoles.block.aria", { app: appName })}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-h3">
            {appName} <span className="font-mono text-label text-muted-foreground">{pack}</span>
          </CardTitle>
          <p className="text-caption text-muted-foreground">
            {ceiling
              ? t("appRoles.block.ceiling", { level: t(LEVEL_KEY[ceiling]) })
              : t("appRoles.block.off")}
          </p>
        </div>
        {readOnly ? null : (
          <Button size="sm" variant="outline" onClick={() => setDialog("create")}>
            <Plus aria-hidden /> {t("appRoles.block.create")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {pack === "knowledge" ? (
          <p className="text-caption text-muted-foreground">{t("appRoles.note.knowledge")}</p>
        ) : null}
        <Table aria-label={t("appRoles.block.tableAria", { app: appName })}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("appRoles.col.role")}</TableHead>
              <TableHead>{t("appRoles.col.level")}</TableHead>
              <TableHead>{t("appRoles.col.people")}</TableHead>
              <TableHead className="text-right">{t("appRoles.col.edit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <RoleRow
                key={r.ref}
                role={r}
                readOnly={readOnly}
                onEdit={() => setDialog({ ref: r.ref, name: r.name.vi, level: r.level })}
                onRemove={() => onRemove(r.ref)}
                onRestore={() => onRestore(r.ref)}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {dialog === "create" ? (
        <RoleDialog
          mode="create"
          appName={appName}
          onSubmit={(v) => onCreate(pack, v.name, v.level)}
          onClose={() => setDialog(null)}
        />
      ) : dialog ? (
        <RoleDialog
          mode="edit"
          appName={appName}
          initial={dialog}
          onSubmit={(v) => onEdit(dialog.ref, v)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Card>
  );
}
