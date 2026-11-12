// Cổng hook cho component (component-no-fetch): danh sách + thêm + gỡ + mở «Tài liệu kèm» của một HĐ.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addFile, fetchFiles, filesKey, openOwnFile, openStepFile, removeFile } from "../api";

export { isPreviewable } from "../api";
export { openOwnFile, openStepFile };

export function useContractFiles(id: string) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: filesKey(id),
    queryFn: ({ signal }) => fetchFiles(id, signal),
    staleTime: 15_000,
  });
  const done = () => qc.invalidateQueries({ queryKey: filesKey(id) });
  const add = useMutation({ mutationFn: (f: File) => addFile(id, f), onSuccess: done });
  const remove = useMutation({
    mutationFn: (fileId: string) => removeFile(id, fileId),
    onSuccess: done,
  });
  return { list, add, remove };
}
