// HUB-FR-124 · AC-H37 · hộp thoại "Thông tin cho quy trình {name}" mở từ `!key` khi quy trình có `inputs`.
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useInputsForm } from "../hooks/use-inputs-form";
import type { InputsRequest } from "../lib/inputs-store";
import { InputField } from "./InputField";

export function InputsForm({ request }: { request: InputsRequest }) {
  const { t } = useTranslation();
  const f = useInputsForm(request);
  const blocked = f.pending || f.uploading !== null || Object.keys(f.blockingErrors).length > 0;
  return (
    <Dialog open onOpenChange={(open) => !open && !f.pending && f.cancel()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void f.submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("process.inputs.form.title", { name: request.item.name })}</DialogTitle>
            <DialogDescription>{t("process.inputs.form.hint")}</DialogDescription>
          </DialogHeader>
          {f.defs.map((def) => (
            <InputField
              key={def.key}
              def={def}
              value={f.values[def.key] ?? { value: "", fileName: "", branch: "" }}
              error={f.errors[def.key]}
              file={{ uploading: f.uploading === def.key, failed: f.fileError === def.key }}
              chips={f.chips}
              disabled={f.pending}
              onChange={(p) => f.patch(def.key, p)}
              onSource={(s) => f.pickSource(def.key, s)}
              onFile={(file) => void f.pickFile(def.key, file)}
            />
          ))}
          {f.error && (
            <p role="alert" className="text-sm text-destructive">
              {f.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={f.pending} onClick={f.cancel}>
              {t("process.inputs.form.cancel")}
            </Button>
            <Button type="submit" disabled={blocked}>
              {t("process.inputs.form.start")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
