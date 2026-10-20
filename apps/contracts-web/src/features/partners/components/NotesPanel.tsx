// V2-I · DT-05 · ghi chú về đối tác: người viết + ngày, thêm / xoá (người viết hoặc quản lý). Dòng lưu từ "Tìm trên internet" có nhãn nguồn.
import type { PartnerNote } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { viDate } from "~/components/shared/format";
import { ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { addNote, deleteNote, fetchNotes, partnerKeys } from "../api";

export function NotesPanel({ party }: { party: string }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.notes.${k}`, o);
  const { write, owner, user } = useMe();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({
    queryKey: partnerKeys.notes(party),
    queryFn: ({ signal }) => fetchNotes(party, signal),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: partnerKeys.notes(party) });
  const add = useMutation({
    mutationFn: () => addNote({ party, body: text.trim() }),
    onSuccess: async () => {
      setText("");
      await refresh();
      toast(L("saved"));
    },
  });
  const del = useMutation({ mutationFn: (id: string) => deleteNote(id), onSuccess: refresh });
  const remove = async (n: PartnerNote) => {
    const ok = await confirmDialog({
      title: L("deleteTitle"),
      body: L("deleteBody"),
      confirmLabel: L("delete"),
      danger: true,
    });
    if (ok) del.mutate(n.id);
  };
  return (
    <section aria-label={L("title")} className="rounded-xl border border-rule bg-panel">
      <div className="flex items-baseline gap-2 px-5 py-3">
        <h3 className="text-[15px] font-semibold">{L("title")}</h3>
        <span className="text-[12.5px] text-dim">{L("optional")}</span>
      </div>
      <div className="px-5 pb-4">
        {write && (
          <div className="mb-3">
            <textarea
              className="field w-full"
              rows={3}
              maxLength={2000}
              value={text}
              placeholder={L("placeholder")}
              aria-label={L("title")}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="btn btn-quiet h-8"
                disabled={add.isPending || !text.trim()}
                onClick={() => add.mutate()}
              >
                {L("save")}
              </button>
            </div>
            {add.isError && (
              <p role="alert" className="text-[12.5px] text-late">
                {t("contracts.errors.unknown")}
              </p>
            )}
          </div>
        )}
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorLine error={q.error} />
        ) : (q.data?.length ?? 0) === 0 ? (
          <p className="text-label text-dim">{L("none")}</p>
        ) : (
          <ul className="space-y-2">
            {q.data?.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 rounded-lg bg-sunk px-3 py-2.5 text-[14px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-dim">
                    {n.by ?? ""} · {viDate(n.at)}{" "}
                    {n.source === "internet" && <Tag tone="soon">{L("fromInternet")}</Tag>}
                  </span>
                  <span className="whitespace-pre-wrap">{n.body}</span>
                </span>
                {write && (owner || n.by_user === user?.id) && (
                  <button
                    type="button"
                    className="btn btn-quiet h-8 px-2 text-late"
                    aria-label={L("deleteAria")}
                    disabled={del.isPending}
                    onClick={() => void remove(n)}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
