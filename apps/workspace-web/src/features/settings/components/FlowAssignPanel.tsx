// CR-182 · khung giao việc bên cạnh sơ đồ: VAI · nhãn, các bước dùng vai, Nhóm hoặc Một người, thành viên, «Bỏ thay đổi» / «Lưu giao việc» (có xác nhận).
// Chỉ quản trị công ty thấy khung này. Ở điện thoại (≤ 640px) khung thành sheet từ dưới lên.
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ai/web-kit/ui/kit/sheet";
import { ToggleGroup, ToggleGroupItem } from "@ai/web-kit/ui/kit/toggle-group";
import { toast } from "@ai/web-kit/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGroups } from "~/features/contract-approval/hooks/use-groups";
import { fetchMembersPage } from "~/features/contracts-list/api";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { PersonPick } from "~/shared/ui/PersonPick";
import { useIsMobile } from "~/shared/ui/use-is-mobile";
import { flowKeys } from "../api-flow";
import { assignRole } from "../api-roles";
import type { CurrentFlow, CurrentGraphStage } from "../lib/current-flow";
import { isDirty, type RolePick, savedPick, stagesOfRole } from "../lib/flow-roles";
import { GroupMembers } from "./FlowAssignMembers";

const K = "contracts.flow.current.assign";
type Kind = "group" | "user";

type ChooserProps = {
  draft: RolePick;
  kind: Kind;
  onKind: (k: Kind) => void;
  onPick: (v: RolePick) => void;
  /** Vai dùng ở nhánh «cùng duyệt» ⇒ chỉ nhận nhóm: khoá «Một người» kèm lý do. */
  groupOnly: boolean;
};

function Chooser({ draft, kind, onKind, onPick, groupOnly }: ChooserProps) {
  const { t } = useTranslation();
  const groups = useGroups(kind === "group");
  const value = draft?.kind === kind ? draft.id : "";
  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        type="single"
        value={kind}
        aria-label={t(`${K}.kind`)}
        onValueChange={(v) => (v === "group" || v === "user") && onKind(v)}
      >
        <ToggleGroupItem value="group" data-testid="assign-kind-group">
          {t(`${K}.kindGroup`)}
        </ToggleGroupItem>
        <ToggleGroupItem value="user" data-testid="assign-kind-user" disabled={groupOnly}>
          {t(`${K}.kindUser`)}
        </ToggleGroupItem>
      </ToggleGroup>
      {groupOnly && (
        <p className="text-caption text-dim" data-testid="assign-group-only">
          {t(`${K}.groupOnly`)}
        </p>
      )}
      {kind === "group" ? (
        <div>
          <span className="mb-1 block text-label font-semibold">{t(`${K}.groupLabel`)}</span>
          <OptionSelect
            value={value}
            onValueChange={(id) =>
              onPick(
                id
                  ? { kind: "group", id, name: groups.data?.find((g) => g.id === id)?.name ?? "" }
                  : null,
              )
            }
            placeholder={t(`${K}.groupPlaceholder`)}
            aria-label={t(`${K}.groupLabel`)}
            data-testid="assign-group"
            className="w-full"
          >
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </OptionSelect>
          {groups.isError && (
            <p role="alert" className="mt-1 text-caption text-late">
              {t(`${K}.groupsFail`)}
            </p>
          )}
        </div>
      ) : (
        <PersonPick
          source="flow-role-user"
          testId="assign-user"
          fetchPage={fetchMembersPage}
          value={value}
          valueName={draft?.kind === "user" ? draft.name : undefined}
          onChange={(id, name) => onPick(id ? { kind: "user", id, name } : null)}
          placeholder={t(`${K}.userPlaceholder`)}
          ariaLabel={t(`${K}.kindUser`)}
        />
      )}
    </div>
  );
}

type PanelProps = { flow: CurrentFlow; stage: CurrentGraphStage; onClose: () => void };

function Body({ flow, stage }: PanelProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const role = stage.role as NonNullable<CurrentGraphStage["role"]>;
  const saved = savedPick(stage);
  const [draft, setDraft] = useState<RolePick>(saved);
  const [kind, setKind] = useState<Kind>(saved?.kind ?? "group");
  const [ask, setAsk] = useState(false);
  const dirty = isDirty(saved, draft);
  const m = useMutation({
    mutationFn: () => assignRole(flow.defId, role.key, draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: flowKeys.flow });
      setAsk(false);
      toast(t(`${K}.saved`));
    },
    onError: (e: unknown) => {
      setAsk(false);
      const unknown = (e as { code?: string })?.code === "ROLE_KEY_UNKNOWN";
      toast(t(unknown ? `${K}.unknownRole` : `${K}.fail`), "late");
    },
  });
  const used = stagesOfRole(flow, role.key);
  return (
    <div data-testid="assign-panel" className="flex flex-col gap-3">
      <h3 className="text-label font-semibold" data-testid="assign-role">
        {t(`${K}.role`, { label: role.label.toUpperCase() })}
      </h3>
      <section>
        <h4 className="mb-1 text-label text-dim">{t(`${K}.usedBy`)}</h4>
        <ul className="list-disc pl-5 text-body" data-testid="assign-used-by">
          {used.map((g) => (
            <li key={g.key}>{g.name}</li>
          ))}
        </ul>
        {used.length > 1 && <p className="mt-1 text-caption text-dim">{t(`${K}.shared`)}</p>}
      </section>
      <Chooser
        draft={draft}
        kind={kind}
        onKind={(k) => {
          setKind(k);
          if (draft?.kind !== k) setDraft(null);
        }}
        onPick={setDraft}
        groupOnly={role.group_only === true}
      />
      {draft?.kind === "group" && <GroupMembers groupId={draft.id} />}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          variant="outline"
          data-testid="assign-discard"
          disabled={!dirty || m.isPending}
          onClick={() => {
            setDraft(saved);
            setKind(saved?.kind ?? "group");
          }}
        >
          {t(`${K}.discard`)}
        </Button>
        <Button
          data-testid="assign-save"
          disabled={!dirty || m.isPending}
          onClick={() => setAsk(true)}
        >
          {t(`${K}.save`)}
        </Button>
      </div>
      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent data-testid="assign-confirm">
          <DialogHeader>
            <DialogTitle>{t(`${K}.confirmTitle`)}</DialogTitle>
            <DialogDescription>{t(`${K}.confirmBody`)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsk(false)}>
              {t(`${K}.confirmCancel`)}
            </Button>
            <Button
              data-testid="assign-confirm-ok"
              disabled={m.isPending}
              onClick={() => m.mutate()}
            >
              {t(`${K}.save`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Khung giao việc của bước đang chọn; điện thoại ⇒ sheet dưới, máy tính ⇒ cột bên cạnh sơ đồ. */
export function FlowAssignPanel(p: PanelProps) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  // `key` theo bước + người đang lưu: lưu xong / đổi bước ⇒ dựng lại nháp từ dữ liệu mới.
  const key = `${p.stage.key}:${p.stage.assigned?.id ?? ""}`;
  if (!mobile)
    return (
      <aside
        aria-label={t(`${K}.panelAria`)}
        className="w-full shrink-0 rounded-xl border border-rule bg-panel p-4 lg:w-80"
      >
        <Body key={key} {...p} />
      </aside>
    );
  return (
    <Sheet open onOpenChange={(o) => !o && p.onClose()}>
      <SheetContent side="bottom" closeLabel={t(`${K}.close`)}>
        <SheetHeader>
          <SheetTitle>{t(`${K}.panelAria`)}</SheetTitle>
          <SheetDescription className="sr-only">{p.stage.name}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <Body key={key} {...p} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
