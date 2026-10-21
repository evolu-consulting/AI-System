// GAP-E #30 · Điều khoản sử dụng + Chính sách bảo mật: trang công khai (không cần đăng nhập), chữ ngắn chung cho nền tảng, vi/en theo i18n.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export type LegalKind = "terms" | "privacy";
const PREFIX: Record<LegalKind, string> = { terms: "t", privacy: "p" };
const SECTIONS = [1, 2, 3, 4, 5, 6] as const;

export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t } = useTranslation();
  const k = (s: string) => t(`contracts.gape.legal.${s}`);
  const p = PREFIX[kind];
  const other: LegalKind = kind === "terms" ? "privacy" : "terms";
  return (
    <div className="min-h-dvh bg-panel text-base leading-[1.6]">
      <main className="mx-auto w-full max-w-[720px] px-6 py-10">
        <Link to="/login" className="text-label text-act hover:underline">
          ← {k("back")}
        </Link>
        <h1 className="mt-4 text-[27px] font-bold tracking-[-0.01em]">{k(kind)}</h1>
        <p className="mt-1 text-caption text-dim">{k("updated")}</p>
        <p className="mt-4 text-ink-2">{k(`${kind}Intro`)}</p>
        {SECTIONS.map((n) => (
          <section key={n} className="mt-6">
            <h2 className="text-card-title font-semibold">
              {n}. {k(`${p}${n}Title`)}
            </h2>
            <p className="mt-1 text-ink-2">{k(`${p}${n}Body`)}</p>
          </section>
        ))}
        <p className="mt-10 border-t border-rule-soft pt-4 text-caption text-dim">
          <Link to={`/${other}`} className="hover:text-ink">
            {k(other)}
          </Link>
        </p>
      </main>
    </div>
  );
}
