// CR-181 · s5 · Cài đặt › Chữ ký: cột phải — xem trước trên tài liệu, thẻ «Chữ ký số» (khoá, Q12), «Yêu cầu đổi chữ ký» (chỉ quản trị).
import type { SignatureSettings } from "@ai/contracts/signature";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { toast } from "@ai/web-kit/ui/toast";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  canvasFromName,
  drawPreview,
  loadSignatureFont,
} from "~/features/my-signature/lib/signature-image";
import { SettingsGroup } from "~/shared/ui/settings-layout";
import { useChangeRequests, useGrantChange } from "../hooks/use-signature-settings";

const k = (x: string) => `contracts.settings.signature.${x}`;

export function SignaturePreview({ s }: { s: SignatureSettings }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  const name = t(k("sampleName"));
  // BR-188-1/2 · dấu trên tài liệu: «Họ tên · Chức vụ · Phòng ban» + dòng «Ký ngày …» luôn có.
  const caption = t(k("sampleCaption"));
  const signedOn = t(k("sampleSignedOn"));
  useEffect(() => {
    let live = true;
    void (async () => {
      await loadSignatureFont().catch(() => undefined);
      const sig = await canvasFromName(name).catch(() => null);
      if (live && ref.current) drawPreview(ref.current, sig, s.ink, { caption, signedOn });
    })();
    return () => {
      live = false;
    };
  }, [name, s.ink, caption, signedOn]);
  return (
    <SettingsGroup title={t(k("preview.title"))}>
      <div className="p-5" data-testid="sig-preview">
        <canvas
          ref={ref}
          width={700}
          height={260}
          aria-label={t(k("preview.title"))}
          className="w-full rounded-md border border-rule bg-panel"
        />
        <p className="mt-2 text-caption text-dim">{t(k("preview.note"), { name })}</p>
      </div>
    </SettingsGroup>
  );
}

export function DigitalCard() {
  const { t } = useTranslation();
  return (
    <SettingsGroup
      title={t(k("digital.title"))}
      action={
        <Badge status="idle" icon={<ICONS.locked className="size-3.5" />}>
          {t(k("digital.off"))}
        </Badge>
      }
    >
      <div className="p-5" data-testid="sig-digital">
        <p className="text-label text-dim">{t(k("digital.note"))}</p>
        <Button variant="outline" className="mt-3" disabled disabledReason={t(k("digital.soon"))}>
          {t(k("digital.enable"))}
        </Button>
      </div>
    </SettingsGroup>
  );
}

/** Chỉ quản trị, chỉ hiện khi có yêu cầu chưa cho phép. */
export function ChangeRequests() {
  const { t } = useTranslation();
  const q = useChangeRequests(true);
  const grant = useGrantChange();
  const rows = (q.data?.items ?? []).filter((r) => r.granted_at === null);
  if (rows.length === 0) return null;
  return (
    <SettingsGroup title={t(k("requests.title"))}>
      <ul className="divide-y divide-rule-soft" data-testid="sig-requests">
        {rows.map((r) => (
          <li key={r.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1 text-label">
              {r.name}
              <span className="ml-2 text-caption text-dim">
                {new Date(r.requested_at).toLocaleString("vi-VN")}
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              busy={grant.isPending}
              aria-label={t(k("requests.allowAria"), { name: r.name })}
              onClick={() =>
                grant.mutate(r.user_id, {
                  onSuccess: () => toast(t(k("requests.granted"), { name: r.name })),
                  onError: () => toast(t(k("requests.fail")), "late"),
                })
              }
            >
              {t(k("requests.allow"))}
            </Button>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}
