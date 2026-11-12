// CR-132 · W3 · tệp chọn trước khi gửi: kiểm định dạng/dung lượng, tải lên ngay (`POST …/files`), cho gỡ trước khi gửi. Lỗi ⇒ khoá i18n nói cách khắc phục.
import { type FileRef, MSG_FILES_MAX } from "@ai/contracts/pack-contracts";
import { useCallback, useState } from "react";
import { uploadFile } from "../api";
import { errorKey } from "../lib/errors";
import { fileProblem } from "../lib/files";

export type Staged = {
  key: string;
  name: string;
  status: "uploading" | "ready";
  ref: FileRef | null;
};

export function useStagedFiles(conversationId: string) {
  const [items, setItems] = useState<Staged[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    (files: readonly File[]) => {
      setError(null);
      let room = MSG_FILES_MAX - items.length;
      for (const f of files) {
        if (room-- <= 0) {
          setError("contracts.messages.err.tooManyFiles");
          break;
        }
        if (fileProblem(f)) {
          setError("contracts.messages.err.file");
          continue;
        }
        const key = crypto.randomUUID();
        setItems((s) => [...s, { key, name: f.name, status: "uploading", ref: null }]);
        uploadFile(conversationId, f)
          .then((ref) =>
            setItems((s) => s.map((x) => (x.key === key ? { ...x, status: "ready", ref } : x))),
          )
          .catch((e: unknown) => {
            setItems((s) => s.filter((x) => x.key !== key));
            setError(errorKey(e));
          });
      }
    },
    [conversationId, items.length],
  );
  const remove = useCallback((key: string) => setItems((s) => s.filter((x) => x.key !== key)), []);
  const clear = useCallback(() => {
    setItems([]);
    setError(null);
  }, []);
  const ready = items.flatMap((x) => (x.ref ? [x.ref] : []));
  return {
    items,
    ready,
    busy: items.some((x) => x.status === "uploading"),
    error,
    add,
    remove,
    clear,
  };
}
