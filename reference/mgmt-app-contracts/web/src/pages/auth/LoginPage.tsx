import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { errText } from "@/api/client";
import { createOrg, login, logout, signup, useMe, useSignupOpen } from "@/api/session";
import { APP_NAME } from "@/app/brand";
import { IconEye, IconEyeOff, IconRobot } from "@/components/icons";

/** Sign in or create an account; a person without an organisation names one next (onboarding). */
export default function LoginPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const open = useSignupOpen();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")), password = String(f.get("password"));
    setBusy(true);
    setErr(null);
    try {
      const me = mode === "in" ? await login(email, password) : await signup(String(f.get("name")), email, password);
      qc.setQueryData(["me"], me);
      nav(me.org ? params.get("next") || "/contracts" : "/onboarding", { replace: true });
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      <div>
        <h1 className="text-[27px] font-bold tracking-[-0.01em]">{mode === "in" ? "Đăng nhập" : "Tạo tài khoản"}</h1>
        <p className="mt-1.5 text-sm text-dim">Hợp đồng, đối tác, giá và chữ ký số ở một chỗ.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === "up" && (
          <label className="text-[13px]">Họ tên
            <input name="name" required className="field mt-1" autoComplete="name" placeholder="Nguyễn Văn A" />
          </label>
        )}
        <label className="text-[13px]">Email
          <input name="email" type="email" required className="field mt-1" autoComplete="email" placeholder="ban@congty.vn" />
        </label>
        <label className="text-[13px]">Mật khẩu
          <span className="relative mt-1 block">
            <input name="password" type={show ? "text" : "password"} required className="field pr-11"
              autoComplete={mode === "in" ? "current-password" : "new-password"} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center text-dim hover:text-ink-2">
              {show ? <IconEyeOff width={19} height={19} /> : <IconEye width={19} height={19} />}
            </button>
          </span>
        </label>
        {err && <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-sm text-late">{err}</p>}
        <button type="submit" className="btn btn-primary h-11" disabled={busy}>
          {busy ? "Đang xử lý…" : mode === "in" ? "Đăng nhập" : "Tạo tài khoản"}
        </button>
        {mode === "in" && <p className="text-[12.5px] text-dim">Quên mật khẩu? Liên hệ quản trị viên công ty bạn để đặt lại.</p>}
      </form>
      {open && <p className="text-center text-sm text-dim">
        {mode === "in" ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
        <button type="button" className="font-semibold text-act underline underline-offset-2"
          onClick={() => { setErr(null); setMode(mode === "in" ? "up" : "in"); }}>
          {mode === "in" ? "Tạo tài khoản" : "Đăng nhập"}
        </button>
      </p>}
    </AuthLayout>
  );
}

export function OnboardingPage() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const open = useSignupOpen();
  const admin = useMe().data?.role === "admin";
  if (!open && !admin) {
    return (
      <AuthLayout>
        <div>
          <h1 className="text-[27px] font-bold tracking-[-0.01em]">Tài khoản chưa thuộc công ty nào</h1>
          <p className="mt-1.5 text-sm text-dim">
            Nhờ chủ công ty bạn thêm email này vào phần Thành viên, rồi đăng nhập lại. Công ty mới: liên hệ Evolu.
          </p>
        </div>
        <button type="button" className="btn btn-outline h-11"
          onClick={async () => { await logout(); qc.clear(); nav("/login", { replace: true }); }}>
          Đăng xuất
        </button>
      </AuthLayout>
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await createOrg(String(new FormData(e.currentTarget).get("name")));
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/contracts", { replace: true });
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  return (
    <AuthLayout>
      <div>
        <h1 className="text-[27px] font-bold tracking-[-0.01em]">Tên công ty của bạn</h1>
        <p className="mt-1.5 text-sm text-dim">Dữ liệu của công ty được tách riêng; bạn mời đồng nghiệp sau.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input name="name" required className="field" placeholder="Công ty TNHH …" aria-label="Tên công ty" autoFocus />
        {err && <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-sm text-late">{err}</p>}
        <button type="submit" className="btn btn-primary h-11" disabled={busy}>{busy ? "Đang tạo…" : "Bắt đầu"}</button>
      </form>
    </AuthLayout>
  );
}

/** The split shell: the form on the left (a plain 520px column), a soft product showcase on the right (≥lg). */
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-panel">
      <main className="flex w-full flex-col px-6 py-8 sm:px-10 lg:w-[520px] lg:shrink-0 lg:px-14">
        <Link to="/login" className="flex items-center gap-2.5">
          <img src="/evolu-icon.svg" alt="" className="h-8 w-8" />
          <span className="text-[17px] font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <div className="mx-auto flex w-full max-w-[384px] flex-1 flex-col justify-center gap-6 py-8">{children}</div>
        <p className="text-[12px] text-dim">Evolu Consulting · <span className="font-mono">Intelligent automation</span></p>
      </main>
      <Showcase />
    </div>
  );
}

function Showcase() {
  return (
    <section aria-hidden className="auth-show hidden flex-1 flex-col gap-6 overflow-hidden pt-14 pl-14 lg:flex">
      <div className="flex items-start gap-5 pr-12">
        <div className="min-w-0">
          <h2 className="max-w-[18ch] text-[27px] leading-tight font-bold tracking-[-0.015em] text-balance">
            Cả hợp đồng, đối tác và chữ ký số — một trợ lý lo giúp.
          </h2>
          <p className="mt-2 text-[15px] text-ink-2">Đăng nhập để xem việc cần làm hôm nay.</p>
        </div>
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-white shadow-lg">
          <IconRobot width={30} height={30} />
        </span>
      </div>
      <AppPreview />
    </section>
  );
}

/** A static, decorative peek at the app (the contracts board), bleeding off the bottom-right corner. */
function AppPreview() {
  const rows: [string, string, string, string, string][] = [
    ["HĐ-2026-014", "Mua bao bì", "Bao Bì Phương Nam", "91.500.000 đ", "ok"],
    ["HĐ-2026-011", "Chữ ký số · 12 CKS", "Viettel-CA", "21.600.000 đ", "soon"],
    ["HĐ-2025-098", "Thuê kho", "Kho Vận Miền Nam", "120.000.000 đ", "late"],
    ["HĐ-2026-016", "Gia công in", "In Ấn Thành Đạt", "34.200.000 đ", "act"],
    ["HĐ-2026-009", "Mua gia vị", "Gia Vị Việt", "58.000.000 đ", "ok"],
  ];
  const pill: Record<string, [string, string]> = {
    ok: ["bg-ok-bg text-ok", "Đang hiệu lực"], soon: ["bg-soon-bg text-soon", "Sắp đáo hạn"],
    late: ["bg-late-bg text-late", "Đã hết hạn"], act: ["bg-act-soft text-act", "Chờ xác nhận"],
  };
  const nav = ["Hợp đồng", "Đối tác", "So sánh giá", "Sản phẩm"];
  return (
    <div className="mt-1 ml-auto flex h-[560px] w-[860px] shrink-0 overflow-hidden rounded-tl-2xl border border-r-0 border-b-0 border-rule bg-panel shadow-[0_24px_60px_rgba(30,27,75,0.18)]">
      <div className="flex w-[188px] shrink-0 flex-col gap-1 border-r border-rule bg-sunk p-4">
        <div className="mb-3 flex items-center gap-2 text-[13.5px] font-bold">
          <img src="/evolu-icon.svg" alt="" className="h-6 w-6" /> {APP_NAME}
        </div>
        {nav.map((n, i) => (
          <span key={n} className={`rounded-lg px-3 py-2 text-[13px] ${i === 0 ? "bg-act-soft font-semibold text-act" : "text-ink-2"}`}>{n}</span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 p-5">
        <div className="flex items-center gap-3">
          <h3 className="text-[20px] font-bold">Hợp đồng</h3>
          <span className="ml-auto rounded-lg bg-act px-3 py-1.5 text-[12.5px] font-semibold text-on-act">+ Thêm hợp đồng</span>
        </div>
        <div className="flex h-[34px] max-w-[280px] items-center rounded-full border border-field px-4 text-[13px] text-dim">Tìm theo tên, đối tác, số HĐ…</div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] tracking-wide text-dim uppercase">
              <th className="border-b border-rule px-2.5 py-2.5 font-semibold">Hợp đồng</th>
              <th className="border-b border-rule px-2.5 py-2.5 font-semibold">Bên bán</th>
              <th className="border-b border-rule px-2.5 py-2.5 text-right font-semibold">Giá trị</th>
              <th className="border-b border-rule px-2.5 py-2.5 font-semibold">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([no, kind, seller, value, tone]) => (
              <tr key={no}>
                <td className="border-b border-rule-soft px-2.5 py-3"><b>{no}</b><span className="block text-[12px] text-dim">{kind}</span></td>
                <td className="border-b border-rule-soft px-2.5 py-3">{seller}</td>
                <td className="border-b border-rule-soft px-2.5 py-3 text-right font-mono whitespace-nowrap">{value}</td>
                <td className="border-b border-rule-soft px-2.5 py-3">
                  <span className={`inline-flex h-[22px] items-center rounded-full px-2.5 text-[11.5px] font-semibold ${pill[tone][0]}`}>{pill[tone][1]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
