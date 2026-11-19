// ADM-FR-06 · độ mạnh mật khẩu: chỉ gợi ý, không chặn (server mới là chuẩn).

export type Strength = "weak" | "medium" | "strong";

/** Điểm = số loại ký tự (thường, HOA, số, ký hiệu) + 1 nếu dài ≥ 14. < 10 ký tự hoặc điểm ≤ 2 → yếu; 3 → vừa; ≥ 4 → mạnh. */
export function passwordStrength(password: string): Strength {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const score = classes + (password.length >= 14 ? 1 : 0);
  if (password.length < 10 || score <= 2) return "weak";
  return score === 3 ? "medium" : "strong";
}
