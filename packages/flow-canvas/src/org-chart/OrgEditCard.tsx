// CR-189 · thẻ phòng ở CHẾ ĐỘ SỬA (admin): cùng nội dung thẻ xem (tên · trưởng phòng · «N người · tổng M» · avatar) + tên bấm để đổi tại chỗ,
// «⋯» (menu do host dựng), «+» thêm phòng con, kéo thả (máy tính). Cỡ thẻ y hệt thẻ xem.
import { PersonAvatar, PersonAvatarGroup } from "@ai/web-kit/ui/kit/person-avatar";
import { useState } from "react";
import { AddChild, type DragRef, dragProps, type OrgChartEdit, RenameName } from "./OrgEditParts";
import { ORG_NODE_H, ORG_NODE_W, type OrgNodeData } from "./org-graph";

type Props = {
  nodeId: string;
  data: OrgNodeData;
  edit: OrgChartEdit;
  drag: DragRef;
  ring: string;
  noHead: string;
  countText: string;
  /** Công ty (gốc ảo): chỉ nhận thả + «+»; không đổi tên/«⋯»/kéo. */
  company: boolean;
};

const OVER_RING = { ok: "ring-2 ring-primary bg-accent", no: "ring-2 ring-destructive" } as const;

export function OrgEditCard({ nodeId, data, edit, drag, ring, noHead, countText, company }: Props) {
  const [over, setOver] = useState<"ok" | "no" | null>(null);
  const id = company ? null : nodeId;
  const staff = data.staff.map((m) => ({ id: m.id, name: m.name, jobTitle: m.jobTitle ?? null }));
  return (
    <div
      data-testid={`org-node-${nodeId}`}
      data-over={over ?? undefined}
      style={{ width: ORG_NODE_W, height: ORG_NODE_H }}
      className={`nopan relative flex flex-col rounded-lg border bg-card text-left text-card-foreground shadow-sm ${over ? OVER_RING[over] : ring} ${company ? "bg-muted" : ""}`}
      {...dragProps(id, edit, drag, setOver)}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 pt-2">
        <div className="flex items-center gap-1">
          {company ? (
            <span className="line-clamp-1 flex-1 text-sm font-semibold leading-tight">
              {data.name}
            </span>
          ) : (
            <>
              <RenameName id={nodeId} name={data.name} edit={edit} />
              <div className="nodrag nopan shrink-0">{edit.renderMenu(nodeId)}</div>
            </>
          )}
        </div>
        {company ? null : (
          <span className="flex items-center gap-2 text-xs">
            {data.head ? (
              <PersonAvatar id={data.head.id} name={data.head.name} size={24} interactive={false} />
            ) : null}
            <span
              data-testid="org-head"
              className={`min-w-0 flex-1 truncate ${data.head ? "" : "text-muted-foreground"}`}
            >
              {data.head ? data.head.name : noHead}
            </span>
          </span>
        )}
        <span className="text-xs text-muted-foreground" data-testid="org-count">
          {countText}
        </span>
      </div>
      <div className="nodrag nopan flex h-9 items-center px-3 pb-2">
        {staff.length > 0 ? (
          <PersonAvatarGroup
            people={staff}
            size={24}
            testId="org-card-avatars"
            className="min-h-6"
          />
        ) : null}
      </div>
      <AddChild id={nodeId} parentId={id} name={data.name} edit={edit} />
    </div>
  );
}
