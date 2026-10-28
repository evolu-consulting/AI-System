// com-fix-community-login · màn Đăng nhập riêng của community-web (mockup: thẻ trắng bo 14px, logo "S", nút tím). Ba bước:
// Mã công ty + Tên đăng nhập + Mật khẩu ⇒ (đối tác lần đầu) Đặt mật khẩu mới ⇒ (nếu bật 2FA) Mã xác thực. Nội bộ đã có phiên
// AI System có thể dùng link SSO. Xong bước nào trả phiên ⇒ `session` đổi sang `authed`, AuthGate tự vẽ app.
import { type FormEvent, type ReactNode, useState } from "react";
import { changePasswordForced, login, verifyTotp } from "../api/auth";
import { SSO_URL } from "../api/session";
import {
  type AuthStage,
  type LoginStep,
  loginError,
  newPasswordError,
  normalizeLoginId,
  ssoLoginHref,
  stepOf,
} from "../lib/login";

const TENANT_KEY = "community:tenant_key";
const remembered = (): string => {
  try {
    return localStorage.getItem(TENANT_KEY) ?? "";
  } catch {
    return "";
  }
};
const remember = (v: string): void => {
  try {
    localStorage.setItem(TENANT_KEY, v);
  } catch {
    /* storage bị chặn */
  }
};

function Field(p: { id: string; label: string; type?: string; auto?: string; value?: string }) {
  return (
    <div className="full">
      <label htmlFor={p.id}>{p.label}</label>
      <input
        id={p.id}
        name={p.id}
        className="field"
        type={p.type ?? "text"}
        autoComplete={p.auto}
        defaultValue={p.value}
        required
      />
    </div>
  );
}

function Shell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="app auth">
      <section className="card authcard">
        <div className="brand">
          <span className="logo">S</span>
          <span>
            <b>Sổ Hợp Tác</b>
            <small>Community</small>
          </span>
        </div>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
        {children}
      </section>
    </div>
  );
}

const val = (f: FormData, k: string): string => String(f.get(k) ?? "");

/** Gửi một bước; trả bước kế. Lỗi ⇒ câu báo theo bước. */
async function run(stage: AuthStage, step: LoginStep, f: FormData): Promise<LoginStep | string> {
  try {
    if (stage === "change") {
      const bad = newPasswordError(val(f, "new_password"), val(f, "confirm_password"));
      if (bad) return bad;
      return stepOf(await changePasswordForced(tokenOf(step), val(f, "new_password")));
    }
    if (stage === "totp") return stepOf(await verifyTotp(tokenOf(step), val(f, "code")));
    const tenant = normalizeLoginId(val(f, "tenant_key"));
    const res = await login({
      tenant_key: tenant,
      username: normalizeLoginId(val(f, "username")),
      password: val(f, "password"),
    });
    remember(tenant);
    return stepOf(res);
  } catch (err) {
    return loginError(err, stage);
  }
}
const tokenOf = (s: LoginStep): string => (s.kind === "done" ? "" : s.token);

const TEXT: Record<AuthStage, { title: string; lead: string; submit: string }> = {
  login: {
    title: "Đăng nhập",
    lead: "Cộng đồng đối tác — dùng tài khoản do bên chủ quản cấp.",
    submit: "Đăng nhập",
  },
  change: {
    title: "Đặt mật khẩu mới",
    lead: "Lần đăng nhập đầu tiên: hãy đổi mật khẩu tạm thành mật khẩu của riêng bạn.",
    submit: "Lưu mật khẩu",
  },
  totp: {
    title: "Xác thực hai bước",
    lead: "Nhập mã 6 số trong ứng dụng xác thực (hoặc mã dự phòng).",
    submit: "Xác nhận",
  },
};

export function LoginPage() {
  const [step, setStep] = useState<LoginStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stage: AuthStage = step && step.kind !== "done" ? step.kind : "login";
  const sso = stage === "login" ? ssoLoginHref(SSO_URL, "community") : null;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await run(stage, step ?? { kind: "done" }, new FormData(e.currentTarget));
    setBusy(false);
    if (typeof r === "string") return setError(r);
    // phiên đã nạp ở api/auth (applyGrant) ⇒ AuthGate vẽ app; còn bước kế thì đổi form
    if (r.kind === "done") history.replaceState(null, "", "/");
    else setStep(r);
  };

  const t = TEXT[stage];
  return (
    <Shell title={t.title} lead={t.lead}>
      <form key={stage} className="form" onSubmit={submit} aria-label={t.title}>
        {stage === "login" && (
          <>
            <Field id="tenant_key" label="Mã công ty" auto="organization" value={remembered()} />
            <Field id="username" label="Tên đăng nhập" auto="username" />
            <Field id="password" label="Mật khẩu" type="password" auto="current-password" />
          </>
        )}
        {stage === "change" && (
          <>
            <Field id="new_password" label="Mật khẩu mới" type="password" auto="new-password" />
            <Field
              id="confirm_password"
              label="Nhập lại mật khẩu mới"
              type="password"
              auto="new-password"
            />
          </>
        )}
        {stage === "totp" && <Field id="code" label="Mã xác thực" auto="one-time-code" />}
        {error && (
          <p className="full autherr" role="alert">
            {error}
          </p>
        )}
        <div className="full">
          <button type="submit" className="primary authbtn" disabled={busy}>
            {t.submit}
          </button>
        </div>
      </form>
      {sso && (
        <p className="authalt">
          Nhân viên bên chủ quản? <a href={sso}>Đăng nhập bằng tài khoản AI System</a>
        </p>
      )}
    </Shell>
  );
}
