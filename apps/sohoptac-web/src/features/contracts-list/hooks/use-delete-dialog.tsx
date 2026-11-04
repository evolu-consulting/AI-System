// Hộp xoá HĐ mở từ nút thùng rác ở dòng danh sách: ở lại danh sách, danh sách làm mới sau xoá.
import { type ReactNode, useState } from "react";
import { DeleteContractDialog } from "~/features/contract-delete/components/DeleteContractDialog";

export function useDeleteDialog(): { open: (id: string) => void; node: ReactNode } {
  const [id, setId] = useState<string | null>(null);
  return {
    open: setId,
    node: id ? <DeleteContractDialog id={id} goList={false} onClose={() => setId(null)} /> : null,
  };
}
