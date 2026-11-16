// CR-179 · đầu trang `/community/me` (phương án A): ảnh bìa thấp, avatar đè mép bìa, hàng tên + vai, chức vụ · phòng ban, công ty, email.
// Khối này `position: relative; z-index: 1` để ảnh bìa (cũng có vị trí) không đè lên chữ.

import type { MyPeopleProfile } from "@ai/contracts/people";
import { Avatar } from "@ai/web-kit/ui/kit/avatar";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { PersonAvatar } from "@ai/web-kit/ui/PersonAvatar";
import { IconButton } from "~/shared/ui/IconButton";
import { useApp } from "../application/ctx";
import { safeCover } from "../domain/brand";
import { meRoleKey, meSubtitle } from "../domain/me-profile";
import { t } from "../i18n";
import { ImagePick } from "./profile/ImagePick";

export function MyProfileHeader({
  mine,
  dept,
  onSave,
}: {
  mine: MyPeopleProfile | null;
  dept: string | null;
  onSave: (kind: "avatar" | "cover") => (v: string | null) => Promise<void>;
}) {
  const { viewer, go, href, brand, toast } = useApp();
  const cover = safeCover(mine?.cover ?? null);
  const subtitle = meSubtitle(mine?.job_title, dept);
  const RoleIcon = viewer.role === "partner" ? ICONS.partner : ICONS.person;
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(viewer.email ?? "");
      toast(t("community.me.emailCopied"));
    } catch {
      /* trình duyệt chặn clipboard: không báo «Đã sao chép» sai sự thật */
    }
  };
  return (
    <>
      <div className="imgedit-host imgedit-cover">
        {cover ? (
          <img
            src={cover}
            alt=""
            data-testid="me-cover"
            className="cover pcover mecover w-full object-cover block"
          />
        ) : (
          <div className="cover pcover mecover" data-testid="me-cover-default" />
        )}
        <ImagePick
          kind="cover"
          testId="me-cover-edit"
          hasImage={cover !== null}
          onSave={onSave("cover")}
        />
      </div>
      <div className="mehero">
        <div className="imgedit-host imgedit-avatar mehero-avatar">
          <PersonAvatar name={viewer.name} src={mine?.avatar} size={72} testId="me-avatar" />
          <ImagePick
            kind="avatar"
            testId="me-avatar-edit"
            hasImage={!!mine?.avatar}
            onSave={onSave("avatar")}
          />
        </div>
        <div className="mehero-info">
          <div className="flex flex-wrap items-center gap-2">
            <h1 data-testid="me-name" className="m-0 min-w-0 text-xl font-semibold">
              {viewer.name}
            </h1>
            <Badge status={viewer.role === "partner" ? "idle" : "info"} icon={<RoleIcon />}>
              <span data-testid="me-role">{t(meRoleKey(viewer.role))}</span>
            </Badge>
          </div>
          {subtitle && (
            <TruncText
              text={subtitle}
              as="div"
              className="text-sm text-muted-foreground"
              data-testid="me-job-title"
            />
          )}
          <div className="flex items-center gap-2 text-sm" data-testid="me-company">
            <a
              href={href({ name: "profile" })}
              data-testid="me-company-row"
              className="inline-flex min-h-11 min-w-0 items-center gap-2 font-semibold sm:min-h-0"
              onClick={(e) => {
                e.preventDefault();
                go({ name: "profile" });
              }}
            >
              <Avatar
                kind="company"
                name={viewer.orgName}
                src={brand.logo}
                size={24}
                className="rounded-full"
                data-testid="me-company-logo"
              />
              <TruncText text={viewer.orgName} focusable={false} />
            </a>
          </div>
          {viewer.email && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <ICONS.email className="size-4 shrink-0" aria-hidden="true" />
              <TruncText text={viewer.email} data-testid="me-email" />
              <IconButton
                aria-label={t("community.me.emailCopy")}
                data-testid="me-email-copy"
                onClick={() => void copyEmail()}
              >
                <ICONS.copy className="size-4" />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
