import { compare, isZero, max, subtract, ZERO } from '@/lib/money';
import { P } from '@/lib/permissions';

/**
 * Who may see what a family owes.
 *
 * <p>`DATA_PRIVACY.md` §4 is unusually specific about fees, and it is specific because the
 * obvious implementation is wrong in two named ways:
 *
 * <ol>
 *   <li><b>§188.1, "the convenience join".</b> "While I'm building the class list, I'll include
 *       the balance so the teacher can chase it." That one column turns a teacher into a debt
 *       collector and exposes a family's finances to a dozen staff. A class teacher sees
 *       everything else about their class and must never see this.</li>
 *   <li><b>§187, the student.</b> "Fee balance and arrears — hidden by default, because a child
 *       should not be told the family owes money." A school with boarders or sixth-formers may
 *       decide otherwise, so it is a tenant setting; until they set it, the answer is no even
 *       for a student who has somehow been granted `FEES_VIEW` directly.</li>
 * </ol>
 *
 * <p>So the permission is necessary and not sufficient, and this module is where the rest of the
 * rule lives.
 */

export type FeeReach =
  /** Every child's ledger. Bursar, finance manager, headmaster. */
  | { kind: 'ALL' }
  /** This guardian's own children, through live links only. */
  | { kind: 'OWN_CHILDREN'; guardianId: string }
  /** This student's own ledger — only where the school has switched it on. */
  | { kind: 'OWN'; studentId: string }
  | { kind: 'NONE' };

export interface FeeViewer {
  principalType: string;
  principalId: string | null;
  permissions: ReadonlySet<string>;
}

/** What the school has decided about who may see money. Data, never a constant in code. */
export interface FeeSettings {
  /** §187. Off until a school turns it on. */
  studentsSeeFeeBalance: boolean;
}

export function feeReach(viewer: FeeViewer, settings: FeeSettings): FeeReach {
  if (!viewer.permissions.has(P.FEES_VIEW)) return { kind: 'NONE' };

  if (viewer.principalType === 'GUARDIAN') {
    return viewer.principalId
      ? { kind: 'OWN_CHILDREN', guardianId: viewer.principalId }
      : { kind: 'NONE' };
  }

  if (viewer.principalType === 'STUDENT') {
    // The second gate. `FEES_VIEW` alone is not enough, and that is the point: a school that
    // grants the permission to a sixth-former by accident has not thereby told a fifteen-year-
    // old that their family is in arrears.
    if (!settings.studentsSeeFeeBalance) return { kind: 'NONE' };
    return viewer.principalId ? { kind: 'OWN', studentId: viewer.principalId } : { kind: 'NONE' };
  }

  return { kind: 'ALL' };
}

/**
 * Whether a balance may appear on a roster, a class list or a child's record.
 *
 * <p>Separate from {@link feeReach} on purpose. Reach answers "whose ledger may this person
 * open"; this answers "may a number appear on a screen that is not about money at all", which is
 * the question §188.1 is actually about. A class teacher opening a child's record has a reason to
 * be there — and still must not learn what the family owes.
 */
export function mayShowBalanceAlongsideAChild(viewer: FeeViewer, settings: FeeSettings): boolean {
  return feeReach(viewer, settings).kind !== 'NONE';
}

// =====================================================================================
// What the money adds up to
// =====================================================================================

export type InvoiceStatusName = 'DRAFT' | 'ISSUED' | 'CANCELLED';

/**
 * How an invoice stands, for a screen to show.
 *
 * <p>Not stored. A settlement state derived from stored amounts is one that cannot drift out of
 * step with them, which is worth more than the query it saves — a column saying PAID beside rows
 * that sum to less than the total is the kind of disagreement nobody spots until an auditor does.
 */
export type SettlementName = 'DRAFT' | 'CANCELLED' | 'UNPAID' | 'PART_PAID' | 'PAID';

/**
 * There is no OVERPAID.
 *
 * <p>An invoice cannot be settled for more than it is worth — `settlement_within_limits` in
 * `20260922130000_fees_and_invoicing` refuses it. Money beyond the invoice stays unallocated on
 * the payment, as credit on the child's account, which is where it belongs: it is the family's
 * money until something is raised for it to settle. A state here for a thing the database will
 * not produce would be dead code implying a case somebody has to handle.
 */
export function settlementOf(
  status: InvoiceStatusName,
  total: string,
  settled: string,
): SettlementName {
  if (status === 'DRAFT') return 'DRAFT';
  if (status === 'CANCELLED') return 'CANCELLED';

  if (isZero(settled)) return 'UNPAID';
  return compare(settled, total) >= 0 ? 'PAID' : 'PART_PAID';
}

/** What is still owed. Never negative: an invoice cannot be over-settled. */
export function outstandingOf(total: string, settled: string): string {
  return max(subtract(total, settled), ZERO);
}
