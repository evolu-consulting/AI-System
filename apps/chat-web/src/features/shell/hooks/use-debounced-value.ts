// CHAT-AC-21 · trì hoãn giá trị (ô tìm: 250 ms) để không gọi API mỗi phím.
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
