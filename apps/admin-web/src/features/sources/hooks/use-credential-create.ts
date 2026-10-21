// HUB-FR-68 · PC2-R10 · FC2 · tạo khoá nguồn: validate → mutate → map lỗi (field / conflict / alert). Token không vào URL/log/cache.
import type { HubSecret } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { useTr } from "@/lib/use-translate";
import { useCreateCredential } from "../api";
import { validateCredentialCreate } from "../lib/credential-schema";
import { classifyCredentialError } from "../lib/errors";

type Opts = {
  tenantId: string | undefined;
  onClose: () => void;
  onCreated: (c: HubSecret) => void;
};

export function useCredentialCreate({ tenantId, onClose, onCreated }: Opts) {
  const { t } = useTranslation();
  const tr = useTr();
  const create = useCreateCredential(tenantId);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({});
  const [alertKey, setAlertKey] = useState<string | null>(null);

  const submit = async () => {
    setAlertKey(null);
    const bad = validateCredentialCreate({ name, value });
    if (bad.name || bad.value) {
      setErrors({ name: bad.name && tr(bad.name), value: bad.value && tr(bad.value) });
      return;
    }
    setErrors({});
    try {
      const cred = await create.mutateAsync({ name: name.trim(), value });
      notifySuccess(t("process.sources.credential.toast.created"));
      onCreated(cred);
      onClose();
    } catch (err) {
      const f = classifyCredentialError(err);
      if (f.type === "field") setErrors({ [f.field]: tr(f.key) });
      else setAlertKey(f.type === "conflict" ? "process.sources.credential.conflict" : f.key);
    }
  };

  return { name, setName, value, setValue, errors, alertKey, isPending: create.isPending, submit };
}
