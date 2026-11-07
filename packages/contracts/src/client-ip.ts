// L1 (TECH-DEBT #224) · CR-124 q5 · IP client từ `X-Forwarded-For` — MỘT nơi dùng chung cho admin-api (giới hạn đăng nhập) và hub-api (trang công khai
// trả lời hợp đồng qua email). Hàm thuần, không I/O.

/**
 * `hops` = số proxy tin cậy đứng trước app; mỗi proxy NỐI địa chỉ nó thấy vào cuối XFF, nên client thật là phần tử
 * thứ `hops` tính từ cuối. Phần client tự ghi (bên trái) bị bỏ qua — không giả mạo được để né giới hạn.
 */
export function forwardedIp(xff: string | undefined, hops: number): string | null {
  if (!xff || hops < 1) return null;
  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // L1c (A-6): ít phần tử hơn số proxy tin cậy ⇒ phần còn lại do client tự ghi ⇒ không tin (xô `unknown`).
  if (parts.length < hops) return null;
  return parts[parts.length - hops] ?? null;
}
