// ADM-FR-04, ADM-FR-63 · drawer 520px tạo/sửa user (URL `?drawer=new|edit&user=`); sau khi tạo hiện khối mật khẩu tạm.
import type { User } from "@ai/contracts";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Translate } from "@/lib/format";
import { useTr } from "@/lib/use-translate";
import type { UserCreateValues } from "../../lib/schemas";
import { TempPasswordStage } from "./TempPasswordStage";
import { UncopiedConfirm } from "./UncopiedConfirm";
import { UserForm, type UserFormErrors } from "./UserForm";
import { UserGroupsField } from "./UserGroupsField";

// Tab "Quyền hiệu lực" nạp lười: không vào chunk /users và chỉ gọi API khi tab được mở.
const UserAccessTab = lazy(() =>
  import("./UserAccessTab").then((m) => ({ default: m.UserAccessTab })),
);

export type CreatedInfo = { username: string; password: string };

type Props = {
  mode: "create" | "edit";
  tenantKey: string;
  /** Chế độ sửa: người dùng đang mở (undefined khi đang tải/không tìm thấy). */
  user?: User;
  loading?: boolean;
  notFound?: boolean;
  isSelf: boolean;
  pending: boolean;
  serverErrors: UserFormErrors;
  created: CreatedInfo | null;
  onSubmit: (values: UserCreateValues) => void;
  onClose: () => void;
};

const FORM_ID = "user-form";

const toDefaults = (u: User | undefined): UserCreateValues => ({
  username: u?.username ?? "",
  display_name: u?.display_name ?? "",
  email: u?.email ?? "",
  role: u?.role ?? "member",
  locale: u?.locale ?? "en",
});

function drawerTitle(t: Translate, p: Props): string {
  if (p.notFound) return t("state.notFound.title");
  if (p.mode === "create" || !p.user) return t("users.drawer.createTitle");
  return t("users.drawer.editTitle", { username: p.user.username, name: p.user.display_name });
}

type BodyProps = Props & {
  onDirtyChange: (dirty: boolean) => void;
  onCopied: () => void;
};

function DrawerBody(p: BodyProps) {
  const { t } = useTranslation();
  if (p.notFound)
    return <p className="text-body text-muted-foreground">{t("state.notFound.body")}</p>;
  if (p.loading) return <Skeleton className="h-64 w-full" />;
  if (p.created) {
    return (
      <TempPasswordStage
        tenantKey={p.tenantKey}
        username={p.created.username}
        password={p.created.password}
        onCopied={p.onCopied}
      />
    );
  }
  const form = (
    <UserForm
      key={p.user ? `${p.user.id}-${p.user.version}` : "new"}
      formId={FORM_ID}
      mode={p.mode}
      tenantKey={p.tenantKey}
      defaults={toDefaults(p.user)}
      selfRole={p.mode === "edit" && p.isSelf}
      serverErrors={p.serverErrors}
      onDirtyChange={p.onDirtyChange}
      onSubmit={p.onSubmit}
    />
  );
  if (p.mode !== "edit" || !p.user) return form;
  return (
    <Tabs defaultValue="info">
      <TabsList>
        <TabsTrigger value="info">{t("users.tab.info")}</TabsTrigger>
        <TabsTrigger value="access">{t("users.tab.access")}</TabsTrigger>
      </TabsList>
      <TabsContent value="info" className="pt-4">
        {form}
        <UserGroupsField groups={p.user.groups} />
      </TabsContent>
      <TabsContent value="access" className="pt-4">
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <UserAccessTab
            userId={p.user.id}
            username={p.user.username}
            tenantKey={p.user.tenant_key}
          />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}

function DrawerFooter({ p, onClose }: { p: Props; onClose: () => void }) {
  const { t } = useTranslation();
  if (p.created) return <Button onClick={onClose}>{t("common.close")}</Button>;
  return (
    <>
      <Button variant="outline" onClick={onClose} disabled={p.pending}>
        {t("common.cancel")}
      </Button>
      {p.notFound || p.loading ? null : (
        <Button type="submit" form={FORM_ID} disabled={p.pending} aria-disabled={p.pending}>
          {t(p.mode === "create" ? "users.create.submit" : "common.save")}
        </Button>
      )}
    </>
  );
}

export function UserDrawer(props: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [askUncopied, setAskUncopied] = useState(false);

  const requestClose = () => {
    if (props.created) return copied ? props.onClose() : setAskUncopied(true);
    return dirty ? setAskDiscard(true) : props.onClose();
  };
  const title = drawerTitle(tr, props);

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 sm:max-w-[520px]"
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">{title}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <DrawerBody {...props} onDirtyChange={setDirty} onCopied={() => setCopied(true)} />
          </div>
          <SheetFooter className="flex-row justify-end border-t border-border">
            <DrawerFooter p={props} onClose={requestClose} />
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title={t("unsaved.title")}
        description={t("unsaved.body")}
        cancelLabel={t("unsaved.stay")}
        confirmLabel={t("unsaved.discard")}
        destructive
        onConfirm={props.onClose}
      />
      <UncopiedConfirm open={askUncopied} onOpenChange={setAskUncopied} onClose={props.onClose} />
    </>
  );
}
