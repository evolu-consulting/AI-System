// ADM-FR-55 · TECH-DEBT #14 · đếm chỉnh sửa form để biết người dùng có gõ thêm trong lúc chờ phản hồi lưu hay không.
import { useEffect, useRef } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

export function useEditCounter<T extends FieldValues>(form: UseFormReturn<T>) {
  const edits = useRef(0);
  useEffect(() => {
    const sub = form.watch(() => {
      edits.current += 1;
    });
    return () => sub.unsubscribe();
  }, [form]);
  return edits;
}
