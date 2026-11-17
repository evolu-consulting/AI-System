// CR-181 · s12 · màn ký toàn màn hình `/contracts/sign/:id`: nối phiên ký (API) với SignWorkspace. `mode` lấy từ phiên.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useDocSign } from "../hooks/use-doc-sign";
import { signFiles } from "../lib/session-map";
import { SignBody } from "./SignBody";

export function SignScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useDocSign(id);
  const nav = useNavigate();
  const s = q.session.data;
  if (q.session.isPending || q.mine.isPending)
    return <p className="p-6 text-sm text-muted-foreground">{t("contracts.docsign.loading")}</p>;
  if (!s || s.mode === "view" || (s.mode === "sign" && !s.turn.allowed))
    return (
      <div role="alert" className="p-6 text-sm" data-testid="sign-unavailable">
        {t("contracts.docsign.noAccess")}
      </div>
    );
  if (signFiles(s).length === 0)
    return (
      <div role="alert" className="p-6 text-sm" data-testid="sign-unavailable">
        {t("contracts.docsign.noFiles")}
      </div>
    );
  return (
    <SignBody
      id={id}
      session={s}
      mine={q.mine.data}
      onExit={() => void nav({ to: "/contracts/c/$id", params: { id } })}
    />
  );
}
