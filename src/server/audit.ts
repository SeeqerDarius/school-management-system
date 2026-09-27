import 'server-only';

import type { Prisma } from '@prisma/client';

/**
 * Writes the audit log.
 *
 * <p>Takes the transaction client, and that is the load-bearing part: an audit entry is written
 * in the same transaction as the change it describes, so the two commit or roll back together.
 * Writing it afterwards would allow a log that says a year was closed when it was not — and an
 * audit trail that can disagree with its own data is not evidence of anything.
 *
 * <p>Nothing sensitive goes in here: no password, no token, no plaintext message, no full payment
 * instrument. The schema cannot enforce that; review must.
 */

/**
 * The narrowest client this needs.
 *
 * <p>Structural rather than the concrete Prisma type, so the same helper takes a plain client, an
 * interactive transaction client, or a tenant-scoped one without three overloads.
 */
export interface AuditWriter {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): unknown;
  };
}

export interface AuditEntry {
  tenantId: string;
  actorUserId: string;
  actorMembershipId: string;
  /** MODULE_NOUN_VERB, past tense: ACADEMIC_YEAR_ACTIVATED. */
  action: string;
  resourceType: string;
  resourceId?: string;
  /** The human-facing reference where one exists, so an auditor can search for what they hold. */
  resourceRef?: string;
  /** Required for high-risk actions — closing a period, reversing a journal, amending a grade. */
  reason?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export async function recordAudit(tx: AuditWriter, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorUserId: entry.actorUserId,
      actorMembershipId: entry.actorMembershipId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      resourceRef: entry.resourceRef ?? null,
      reason: entry.reason ?? null,
      ...(entry.before === undefined ? {} : { beforeValue: entry.before }),
      ...(entry.after === undefined ? {} : { afterValue: entry.after }),
    },
  });
}
