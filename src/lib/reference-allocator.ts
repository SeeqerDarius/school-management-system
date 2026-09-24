import 'server-only';

import type { TenantClient } from '@/server/tenant-scope';

/**
 * Allocate a human-facing reference number using the reference sequence table.
 * 
 * Usage:
 * ```ts
 * const reference = await allocateReference(tx, 'STUDENT');
 * // Returns something like "STU-2026-000123"
 * ```
 * 
 * This uses row-level locking to ensure concurrent requests don't get the same number.
 */
export async function allocateReference(tx: TenantClient, tenantId: string, scope: string): Promise<string> {
  const currentYear = new Date().getFullYear();
  const periodKey = currentYear.toString();
  const prefix = scope.substring(0, 3).toUpperCase();
  
  const sequence = await tx.referenceSequence.upsert({
    where: { tenantId_scope_periodKey: { tenantId, scope, periodKey } },
    create: { tenantId, scope, periodKey, prefix, padWidth: 6, nextValue: 2n },
    update: { nextValue: { increment: 1n } },
    select: { nextValue: true, prefix: true, padWidth: true },
  });

  // nextValue stores the next unused value. Upsert returned the value after the one allocated.
  const paddedNumber = (sequence.nextValue - 1n).toString().padStart(sequence.padWidth, '0');
  
  return `${prefix}-${currentYear}-${paddedNumber}`;
}

/**
 * Get the next reference number without allocating it (for preview).
 */
export async function getNextReference(tx: TenantClient, tenantId: string, scope: string): Promise<string> {
  const currentYear = new Date().getFullYear();
  const periodKey = currentYear.toString();
  const prefix = scope.substring(0, 3).toUpperCase();
  
  const sequence = await tx.referenceSequence.findUnique({
    where: { tenantId_scope_periodKey: { tenantId, scope, periodKey } },
    select: { nextValue: true, padWidth: true },
  });

  if (!sequence) {
    return `${prefix}-${currentYear}-000001`;
  }

  const paddedNumber = sequence.nextValue.toString().padStart(sequence.padWidth, '0');
  
  return `${prefix}-${currentYear}-${paddedNumber}`;
}
