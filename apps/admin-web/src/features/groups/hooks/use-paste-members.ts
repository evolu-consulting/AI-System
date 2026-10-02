// ADM-FR-62 · M3-R03 · D12 · dán danh sách username: tách bằng parseUsernameList của contract, tối đa 500, thêm một phần;
// sau khi gửi ô dán chỉ còn các username `not_found` để sửa tại chỗ.
import { GROUP_PASTE_MAX, type Group, parseUsernameList } from "@ai/contracts";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useAddMembers } from "../api";
import { usePastePreview } from "./use-paste-preview";

export function usePasteMembers(group: Group) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const add = useAddMembers(group.id);
  const [text, setText] = useState("");
  const names = useMemo(() => parseUsernameList(text), [text]);
  const tooMany = names.length > GROUP_PASTE_MAX;
  const { preview, checking } = usePastePreview(group.id, names, !tooMany);

  const submit = async () => {
    try {
      const res = await add.mutateAsync({ usernames: names });
      const name = pickLocalized(group.name, i18n.language);
      const missing = res.not_found.length;
      notifySuccess(
        missing === 0
          ? t("groups.toast.pasted", { count: res.added.length, group: name })
          : t("groups.toast.pastedPartial", { added: res.added.length, missing }),
      );
      setText(res.not_found.join("\n"));
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    }
  };
  return {
    text,
    setText,
    count: names.length,
    tooMany,
    preview,
    checking,
    submit,
    pending: add.isPending,
  };
}
