// com-fix-community-login · màn Đăng nhập riêng của community-web (bố cục 2 cột: form trái + showcase phải; VI/EN tự chứa trong login-i18n). Ba bước:
// Mã công ty + Tên đăng nhập + Mật khẩu ⇒ (đối tác lần đầu) Đặt mật khẩu mới ⇒ (nếu bật 2FA) Mã xác thực. Nội bộ đã có phiên
// AI System có thể dùng link SSO. Xong bước nào trả phiên ⇒ `session` đổi sang `authed`, AuthGate tự vẽ app.
import { type FormEvent, useState } from "react";
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
import { LoginShowcase } from "./LoginShowcase";
import { type Lang, LOGIN_TEXT, type LoginText, readLang, saveLang } from "./login-i18n";

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

function Field(p: {
  id: string;
  label: string;
  type?: string;
  auto?: string;
  value?: string;
  hint?: string;
  ph?: string;
  mono?: boolean;
  eye?: [string, string];
}) {
  const [shown, setShown] = useState(false);
  const type = p.eye && shown ? "text" : (p.type ?? "text");
  const cls = [p.mono ? "lg-mono" : "", p.eye ? "lg-pw" : ""].join(" ").trim();
  return (
    <div className="lg-field">
      <label htmlFor={p.id}>{p.label}</label>
      <div className="lg-inp">
        <input
          id={p.id}
          name={p.id}
          className={cls || undefined}
          type={type}
          autoComplete={p.auto}
          defaultValue={p.value}
          placeholder={p.ph}
          aria-describedby={p.hint ? `${p.id}-hint` : undefined}
          spellCheck={false}
          required
        />
        {p.eye && (
          <button
            type="button"
            className="lg-eye"
            aria-label={shown ? p.eye[1] : p.eye[0]}
            onClick={() => setShown(!shown)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
              {shown && <path d="M4 4l16 16" />}
            </svg>
          </button>
        )}
      </div>
      {p.hint && (
        <span id={`${p.id}-hint`} className="lg-hint">
          {p.hint}
        </span>
      )}
    </div>
  );
}

function LangSwitch({ lang, onPick }: { lang: Lang; onPick: (l: Lang) => void }) {
  return (
    <fieldset className="lg-lang" aria-label="Language">
      {(["vi", "en"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => onPick(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </fieldset>
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

const STAGE_KEYS = {
  login: ["loginTitle", "loginLead", "loginSubmit"],
  change: ["changeTitle", "changeLead", "changeSubmit"],
  totp: ["totpTitle", "totpLead", "totpSubmit"],
} as const satisfies Record<AuthStage, readonly (keyof LoginText)[]>;

function StageFields({ stage, t }: { stage: AuthStage; t: LoginText }) {
  const eye: [string, string] = [t.showPw, t.hidePw];
  if (stage === "change")
    return (
      <>
        <Field
          id="new_password"
          label={t.newPassword}
          type="password"
          auto="new-password"
          eye={eye}
        />
        <Field
          id="confirm_password"
          label={t.confirmPassword}
          type="password"
          auto="new-password"
          eye={eye}
        />
      </>
    );
  if (stage === "totp") return <Field id="code" label={t.code} auto="one-time-code" mono />;
  return (
    <>
      <Field
        id="tenant_key"
        label={t.tenant}
        hint={t.tenantHint}
        auto="organization"
        value={remembered()}
        mono
      />
      <Field id="username" label={t.username} ph={t.usernamePh} auto="username" />
      <Field id="password" label={t.password} type="password" auto="current-password" eye={eye} />
    </>
  );
}

export function LoginPage() {
  const [lang, setLang] = useState<Lang>(readLang);
  const [step, setStep] = useState<LoginStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stage: AuthStage = step && step.kind !== "done" ? step.kind : "login";
  const sso = stage === "login" ? ssoLoginHref(SSO_URL, "community") : null;
  const t = LOGIN_TEXT[lang];
  const [kTitle, kLead, kSubmit] = STAGE_KEYS[stage];
  const pick = (l: Lang) => {
    saveLang(l);
    setLang(l);
  };

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

  return (
    <div className="login">
      <main className="lg-form-pane">
        <div className="lg-head">
          <div className="lg-brand">
            <span className="lg-logo">S</span>
            <span>
              <b>Sổ Hợp Tác</b>
              <small>Community</small>
            </span>
          </div>
          <LangSwitch lang={lang} onPick={pick} />
        </div>
        <div className="lg-wrap">
          <div className="lg-box">
            <div className="lg-title">
              <h1>{t[kTitle]}</h1>
              <p>{t[kLead]}</p>
            </div>
            <form key={stage} className="lg-form" onSubmit={submit} aria-label={t[kTitle]}>
              <StageFields stage={stage} t={t} />
              {error && (
                <p className="lg-err" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="lg-primary" disabled={busy}>
                {t[kSubmit]}
              </button>
              {stage === "login" && <p className="lg-forgot">{t.forgot}</p>}
            </form>
            {sso && (
              <p className="lg-alt">
                {t.ssoPrefix}
                <a href={sso}>{t.ssoLink}</a>
              </p>
            )}
          </div>
        </div>
        <p className="lg-foot">{t.footer}</p>
      </main>
      <LoginShowcase t={t} />
    </div>
  );
}
