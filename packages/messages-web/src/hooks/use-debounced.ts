import { useEffect, useState } from "react";

/** Giá trị trễ `ms` mili giây (ô tìm gọi server không mỗi phím). */
export function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}
