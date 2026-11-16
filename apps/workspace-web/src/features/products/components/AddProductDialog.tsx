// gap-d1 #18 · "Thêm sản phẩm" tay (tên, nhóm, đơn vị, quy cách) ⇒ `POST /products`; xong mở chi tiết SP vừa tạo.

import type { ProductGroup } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { knownCatalogError, useCreateProduct } from "../hooks/use-catalog";
import { productBody } from "../lib/catalog";
import { Field } from "./Field";

const GROUPS: readonly ProductGroup[] = ["goods", "service", "referral"];
const EMPTY = { name: "", group: "goods" as ProductGroup, unit: "", spec: "" };

export function AddProductDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.add.${k}`);
  const nav = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateProduct();
  const body = productBody(f);
  const close = () => {
    setF(EMPTY);
    setErr(null);
    onOpenChange(false);
  };
  const submit = () => {
    if (!body) return;
    setErr(null);
    create.mutate(body, {
      onSuccess: (p) => {
        close();
        void nav({ to: "/contracts/products", search: { sp: p.id } });
      },
      onError: (e) => {
        const code = knownCatalogError(e);
        setErr(code ? t(`contracts.gapd1.errors.${code}`) : t("contracts.errors.unknown"));
      },
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setErr(null);
        onOpenChange(o);
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="sm:max-w-[480px]"
      >
        <DialogHeader>
          <DialogTitle>{L("title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field
            id="gd1-p-name"
            label={L("name")}
            value={f.name}
            maxLength={300}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="gd1-p-group" className="text-label text-ink-2">
              {L("group")}
            </label>
            <OptionSelect
              id="gd1-p-group"
              data-testid="gd1-p-group"
              value={f.group}
              onValueChange={(v) => setF({ ...f, group: v as ProductGroup })}
            >
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(`contracts.catalog.group.${g}`)}
                </option>
              ))}
            </OptionSelect>
          </div>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <Field
              id="gd1-p-unit"
              label={L("unit")}
              value={f.unit}
              maxLength={40}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
            />
            <Field
              id="gd1-p-spec"
              label={L("spec")}
              value={f.spec}
              maxLength={500}
              onChange={(e) => setF({ ...f, spec: e.target.value })}
            />
          </div>
          {err && (
            <p role="alert" className="text-sm text-late">
              {err}
            </p>
          )}
        </DialogBody>
        <DialogFooter className="flex-row justify-end">
          <Button variant="quiet" onClick={close}>
            {t("contracts.psup.close")}
          </Button>
          <Button
            variant="primary"
            data-testid="gd1-p-save"
            disabled={!body || create.isPending}
            onClick={submit}
          >
            {L("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
