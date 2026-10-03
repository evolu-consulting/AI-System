import { createFileRoute } from "@tanstack/react-router";
import { AuditDetailSheet } from "@/features/audit/pages/AuditDetailSheet";

export const Route = createFileRoute("/_authed/audit/$auditId")({ component: AuditDetailSheet });
