// ADM-FR-62 · M3-R03 · thêm từng người vào group: tìm user trong tenant (debounce 300 ms) rồi POST {usernames:[x]}.
import type { Group } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { useUserList } from "@/features/users/api";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useAddMembers } from "../api";

const DEBOUNCE_MS = 300;

export function useMemberAdd(group: Group) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const users = useUserList(
    { tenantId: group.tenant_id, q: debounced, offset: 0 },
    debounced !== "",
  );
  const add = useAddMembers(group.id);
  const options = (users.data?.items ?? []).map((u) => ({
    username: u.username,
    label: u.display_name,
  }));
  const pick = async (username: string) => {
    try {
      const res = await add.mutateAsync({ usernames: [username] });
      if (res.added.includes(username)) {
        const name = pickLocalized(group.name, i18n.language);
        notifySuccess(t("groups.toast.memberAdded", { username, group: name }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    }
  };
  return { options, isLoading: users.isFetching, setQuery: setQ, pick };
}
