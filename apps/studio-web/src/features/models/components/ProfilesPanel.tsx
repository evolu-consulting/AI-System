// HUB-FR-67 · tab Profiles: tải / rỗng / lỗi / không quyền; danh sách trái + editor phải (artboard Models).
// `selected`: id profile đang mở | "new" | null. Editor được key theo id:version nên đổi phiên bản server thì nạp lại bản nháp.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "#/components/shared/EmptyState";
import { ErrorState } from "#/components/shared/ErrorState";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { useProfiles } from "../hooks/use-profiles";
import { useProviders } from "../hooks/use-providers";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileList } from "./ProfileList";

const code = (e: unknown) => (e as { code?: unknown } | null)?.code;

export function ProfilesPanel() {
  const { t } = useTranslation();
  const q = useProfiles();
  const providers = useProviders();
  const [selected, setSelected] = useState<string | null>(null);
  const items = q.data?.items ?? [];

  if (q.error) {
    return code(q.error) === "FORBIDDEN" ? (
      <EmptyState message={t("models.state.forbidden")} />
    ) : (
      <ErrorState code={String(code(q.error) ?? "") || undefined} onRetry={() => q.refetch()} />
    );
  }
  if (q.isPending) {
    return (
      <div aria-busy="true" className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  const current = items.find((p) => p.id === selected) ?? null;
  const creating = selected === "new";
  if (items.length === 0 && !creating) {
    return (
      <EmptyState
        message={t("models.state.empty.profiles")}
        action={<Button onClick={() => setSelected("new")}>{t("models.profile.add")}</Button>}
      />
    );
  }
  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <ProfileList
        items={items}
        selected={selected}
        onSelect={setSelected}
        onNew={() => setSelected("new")}
      />
      {creating || current ? (
        <ProfileEditor
          key={current ? `${current.id}:${current.version}` : "new"}
          profile={current}
          providers={providers.data?.items ?? []}
          onSaved={setSelected}
          onDeleted={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
