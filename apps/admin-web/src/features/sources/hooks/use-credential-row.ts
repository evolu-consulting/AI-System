// HUB-FR-68 · PC2-R10 · FC2 · một khoá nguồn: thay token (rotate) + xoá. Token KHÔNG vào log/URL.
import type { HubSecret } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { useDeleteCredential, useRotateCredential } from "../api";
import { credentialTokenError } from "../lib/credential-schema";
import { classifyCredentialError } from "../lib/errors";

export function useCredentialRow(cred: HubSecret, tenantId: string | undefined) {
  const { t } = useTranslation();
  const rotate = useRotateCredential(cred.id, tenantId);
  const del = useDeleteCredential(tenantId);
  const [token, setToken] = useState("");
  const [rotating, setRotating] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const submitRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = credentialTokenError(token);
    if (bad) return setErr(t(bad));
    setErr(undefined);
    try {
      await rotate.mutateAsync({ version: cred.version, value: token });
      notifySuccess(t("process.sources.credential.toast.rotated"));
      setToken("");
      setRotating(false);
    } catch (e2) {
      const f = classifyCredentialError(e2);
      if (f.type === "field") setErr(t(f.key));
      else if (f.type === "conflict") notifyError(t("process.sources.credential.conflict"));
      else setErr(t(f.key));
    }
  };

  const confirmDelete = async () => {
    await del.mutateAsync({ id: cred.id, version: cred.version });
    notifySuccess(t("process.sources.credential.toast.deleted"));
  };

  const cancelRotate = () => {
    setRotating(false);
    setToken("");
    setErr(undefined);
  };

  return {
    token,
    setToken,
    rotating,
    setRotating,
    err,
    isPending: rotate.isPending,
    submitRotate,
    confirmDelete,
    cancelRotate,
  };
}
