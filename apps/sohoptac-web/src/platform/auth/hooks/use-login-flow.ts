// CR-118 · cr118-auth · luồng login gộp cho UI: password → đổi mật khẩu bắt buộc → TOTP → xong (`onDone(user)`).
// UI chỉ gọi hook này (không gọi adapter). Token bước hết hạn ⇒ về form mật khẩu kèm câu báo.
import type { LoginRequest, LoginResponse, Me } from "@ai/contracts/chat";
import { useState } from "react";
import { adminApiAuth } from "../adapters/admin-api";
import { type LoginStep, stepOf } from "../domain/login-machine";
import { type AuthStage, errorOf, type LoginMessage, newPasswordError } from "../lib/login-errors";
import type { AuthPort } from "../port";

export type LoginFlow = {
  step: LoginStep<Me>;
  busy: boolean;
  error: LoginMessage | null;
  submitLogin: (req: LoginRequest) => Promise<void>;
  submitChange: (next: string, confirm: string) => Promise<void>;
  submitTotp: (code: string) => Promise<void>;
  restart: () => void;
};

const LOGIN: LoginStep<Me> = { kind: "login" };
const tokenOf = (s: LoginStep<Me>): string =>
  s.kind === "change" || s.kind === "totp" ? s.token : "";

export function useLoginFlow(
  onDone: (user: Me) => void | Promise<void>,
  port: AuthPort = adminApiAuth,
): LoginFlow {
  const [step, setStep] = useState<LoginStep<Me>>(LOGIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoginMessage | null>(null);

  async function run(stage: AuthStage, call: () => Promise<LoginResponse>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = stepOf(await call());
      if (next.kind === "done") await onDone(next.user);
      setStep(next);
    } catch (err) {
      const msg = errorOf(err, stage);
      if (msg.key === "contracts.login.expired") setStep(LOGIN);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return {
    step,
    busy,
    error,
    submitLogin: (req) => run("login", () => port.login(req)),
    submitChange: async (next, confirm) => {
      const bad = newPasswordError(next, confirm);
      if (bad) return setError(bad);
      await run("change", () => port.changePassword(tokenOf(step), next));
    },
    submitTotp: (code) => run("totp", () => port.verifyTotp(tokenOf(step), code)),
    restart: () => {
      setError(null);
      setStep(LOGIN);
    },
  };
}
