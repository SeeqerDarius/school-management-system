import 'server-only';

import {
  feeReach,
  outstandingOf,
  settlementOf,
  type FeeReach,
  type InvoiceStatusName,
  type SettlementName,
} from '@/lib/fee-visibility';
import { add, amount, subtract, ZERO } from '@/lib/money';
import { P } from '@/lib/permissions';
import { requireActiveSession } from '@/server/auth/session';

/**
 * Reads for fees, invoicing and payments.
 *
 * <p>Two things about this module are deliberate and worth not undoing.
 *
 * <p><b>Amounts leave here as strings.</b> Prisma hands back a `Decimal`; every function below
 * converts it with `amount()` before it crosses into a page. A `Decimal` reaching a Server
 * Component becomes a serialisation problem, and the obvious fix — `Number(d)` — is the exact
 * failure I-2 exists to prevent.
 *
 * <p><b>Reach is a `where` clause, never a filter.</b> A guardian's query never touches another
 * family's invoice. Fetching the school's ledger and hiding rows in the template would mean every
 * family's arrears had already been loaded into the process rendering one family's page.
 */

export const FEES_PATH = '/fees';

async function viewer() {
  const session = await requireActiveSession();

  const settings = await session.transaction((db) =>
    db.tenant.findFirst({
      where: { id: session.tenantId },
      select: { studentsSeeFeeBalance: true, defaultCurrency: true },
    }),
  );

  const reach = feeReach(
    {
      principalType: session.principalType,
      principalId: session.principalId,
      permissions: session.permissions,
    },
    { studentsSeeFeeBalance: settings?.studentsSeeFeeBalance ?? false },
  );

  return { session, reach, currency: settings?.defaultCurrency ?? 'GHS' };
}

/** The reach, as a restriction on `student`. */
function studentsInReach(reach: FeeReach) {
  switch (reach.kind) {
    case 'ALL':
      return {};
    case 'OWN_CHILDREN':
      // A revoked guardian link confers nothing, here as everywhere else. A parent a court has
      // excluded stops seeing the fee ledger on the next page load.
      return { guardians: { some: { guardianId: reach.guardianId, revokedAt: null } } };
    case 'OWN':
      return { id: reach.studentId };
    case 'NONE':
      return { id: '00000000-0000-0000-0000-000000000000' };
  }
}

export interface InvoiceRow {
  id: string;
  invoiceNo: string | null;
  studentId: string;
  studentName: string;
  reference: string;
  termName: string;
  status: InvoiceStatusName;
  settlement: SettlementName;
  currency: string;
  total: string;
  settled: string;
  outstanding: string;
  issuedOn: Date | null;
  dueOn: Date | null;
}

/**
 * How much of an invoice has been settled.
 *
 * <p>Payments allocated to it plus credit notes raised against it. Summed rather than stored: a
 * cached `paid` column and the rows behind it disagree eventually, and when they do the column is
 * what every screen shows and the rows are what is true.
 */
function settledOn(invoice: {
  allocations: { amount: unknown }[];
  creditNotes: { amount: unknown }[];
}): string {
  const parts = [
    ...invoice.allocations.map((a) => amount(String(a.amount))),
    ...invoice.creditNotes.map((c) => amount(String(c.amount))),
  ];
  return parts.length === 0 ? ZERO : add(...parts);
}

const INVOICE_SELECT = {
  id: true,
  invoiceNo: true,
  studentId: true,
  status: true,
  currency: true,
  total: true,
  issuedOn: true,
  dueOn: true,
  term: { select: { name: true } },
  student: { select: { reference: true, firstName: true, lastName: true, preferredName: true } },
  allocations: { select: { amount: true } },
  creditNotes: { select: { amount: true } },
} as const;

function toRow(row: {
  id: string;
  invoiceNo: string | null;
  studentId: string;
  status: string;
  currency: string;
  total: unknown;
  issuedOn: Date | null;
  dueOn: Date | null;
  term: { name: string };
  student: { reference: string; firstName: string; lastName: string; preferredName: string | null };
  allocations: { amount: unknown }[];
  creditNotes: { amount: unknown }[];
}): InvoiceRow {
  const total = amount(String(row.total));
  const settled = settledOn(row);
  const status = row.status as InvoiceStatusName;

  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    studentId: row.studentId,
    studentName: [row.student.preferredName ?? row.student.firstName, row.student.lastName]
      .filter(Boolean)
      .join(' '),
    reference: row.student.reference,
    termName: row.term.name,
    status,
    settlement: settlementOf(status, total, settled),
    currency: row.currency,
    total,
    settled,
    outstanding: outstandingOf(total, settled),
    issuedOn: row.issuedOn,
    dueOn: row.dueOn,
  };
}

export interface LedgerSummary {
  invoiced: string;
  settled: string;
  outstanding: string;
  /** Money received that no invoice has claimed yet — the family's, until something is raised. */
  creditOnAccount: string;
  currency: string;
}

export interface InvoiceList {
  rows: InvoiceRow[];
  summary: LedgerSummary;
  canRaise: boolean;
  canRecordPayment: boolean;
  reach: FeeReach['kind'];
}

export async function listInvoices(studentId?: string): Promise<InvoiceList> {
  const { session, reach, currency } = await viewer();

  const empty: InvoiceList = {
    rows: [],
    summary: { invoiced: ZERO, settled: ZERO, outstanding: ZERO, creditOnAccount: ZERO, currency },
    canRaise: false,
    canRecordPayment: false,
    reach: reach.kind,
  };
  if (reach.kind === 'NONE') return empty;

  const result = await session.transaction(async (db) => {
    const invoices = await db.invoice.findMany({
      where: {
        student: studentsInReach(reach),
        ...(studentId ? { studentId } : {}),
      },
      orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: INVOICE_SELECT,
    });

    // Credit on account is payment money no invoice has claimed. Read from the payments in
    // reach rather than inferred from the invoices, because a family can pay before anything
    // has been raised — which is common at the start of a term.
    const payments = await db.payment.findMany({
      where: { status: 'RECORDED', student: studentsInReach(reach), ...(studentId ? { studentId } : {}) },
      select: { amount: true, allocations: { select: { amount: true } } },
    });

    return { invoices, payments };
  });

  const rows = result.invoices.map(toRow);
  const live = rows.filter((row) => row.status !== 'CANCELLED' && row.status !== 'DRAFT');

  const creditOnAccount = result.payments.reduce((total, payment) => {
    const allocated =
      payment.allocations.length === 0
        ? ZERO
        : add(...payment.allocations.map((a) => amount(String(a.amount))));
    return add(total, subtract(amount(String(payment.amount)), allocated));
  }, ZERO);

  return {
    rows,
    summary: {
      invoiced: live.length === 0 ? ZERO : add(...live.map((row) => row.total)),
      settled: live.length === 0 ? ZERO : add(...live.map((row) => row.settled)),
      outstanding: live.length === 0 ? ZERO : add(...live.map((row) => row.outstanding)),
      creditOnAccount,
      currency: rows[0]?.currency ?? currency,
    },
    canRaise: session.permissions.has(P.INVOICE_CREATE),
    canRecordPayment: session.permissions.has(P.PAYMENT_RECORD),
    reach: reach.kind,
  };
}

export interface InvoiceLineView {
  id: string;
  description: string;
  quantity: number;
  unitAmount: string;
  discount: string;
  lineTotal: string;
}

export interface InvoiceDetail extends InvoiceRow {
  lines: InvoiceLineView[];
  payments: Array<{ id: string; receiptNo: string | null; amount: string; receivedOn: Date }>;
  credits: Array<{ id: string; amount: string; reason: string; issuedOn: Date }>;
  canIssue: boolean;
  canCancel: boolean;
  canCredit: boolean;
  canAllocate: boolean;
}

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  const { session, reach } = await viewer();
  if (reach.kind === 'NONE') return null;

  const row = await session.transaction((db) =>
    db.invoice.findFirst({
      where: { id, student: studentsInReach(reach) },
      select: {
        ...INVOICE_SELECT,
        lines: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            description: true,
            quantity: true,
            unitAmount: true,
            discount: true,
            lineTotal: true,
          },
        },
        allocations: {
          select: {
            amount: true,
            payment: { select: { id: true, receiptNo: true, receivedOn: true } },
          },
        },
        creditNotes: {
          orderBy: { issuedOn: 'desc' },
          select: { id: true, amount: true, reason: true, issuedOn: true },
        },
      },
    }),
  );

  if (!row) return null;

  return {
    ...toRow({ ...row, allocations: row.allocations, creditNotes: row.creditNotes }),
    lines: row.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitAmount: amount(String(line.unitAmount)),
      discount: amount(String(line.discount)),
      lineTotal: amount(String(line.lineTotal)),
    })),
    payments: row.allocations.map((allocation) => ({
      id: allocation.payment.id,
      receiptNo: allocation.payment.receiptNo,
      amount: amount(String(allocation.amount)),
      receivedOn: allocation.payment.receivedOn,
    })),
    credits: row.creditNotes.map((credit) => ({
      id: credit.id,
      amount: amount(String(credit.amount)),
      reason: credit.reason,
      issuedOn: credit.issuedOn,
    })),
    canIssue: session.permissions.has(P.INVOICE_CREATE),
    canCancel: session.permissions.has(P.INVOICE_CANCEL),
    // Crediting an issued invoice is the waiver path, and §188 puts it behind its own
    // permission — the bursar discounts a draft, the finance manager waives a debt.
    canCredit: session.permissions.has(P.FEES_WAIVE),
    canAllocate: session.permissions.has(P.PAYMENT_ALLOCATE),
  };
}

export interface PaymentRow {
  id: string;
  receiptNo: string | null;
  studentName: string;
  studentReference: string;
  method: string;
  /** The bank or mobile-money reference the payment came in with — not the child's. */
  reference: string | null;
  amount: string;
  allocated: string;
  unallocated: string;
  currency: string;
  receivedOn: Date;
  status: string;
}

export async function listPayments(studentId?: string): Promise<PaymentRow[]> {
  const { session, reach, currency } = await viewer();
  if (reach.kind === 'NONE') return [];

  const rows = await session.transaction((db) =>
    db.payment.findMany({
      where: { student: studentsInReach(reach), ...(studentId ? { studentId } : {}) },
      orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: {
        id: true,
        receiptNo: true,
        method: true,
        reference: true,
        amount: true,
        currency: true,
        receivedOn: true,
        status: true,
        student: { select: { reference: true, firstName: true, lastName: true, preferredName: true } },
        allocations: { select: { amount: true } },
      },
    }),
  );

  return rows.map((row) => {
    const total = amount(String(row.amount));
    const allocated =
      row.allocations.length === 0
        ? ZERO
        : add(...row.allocations.map((a) => amount(String(a.amount))));

    return {
      id: row.id,
      receiptNo: row.receiptNo,
      studentName: [row.student.preferredName ?? row.student.firstName, row.student.lastName]
        .filter(Boolean)
        .join(' '),
      studentReference: row.student.reference,
      method: row.method,
      reference: row.reference,
      amount: total,
      allocated,
      unallocated: subtract(total, allocated),
      currency: row.currency ?? currency,
      receivedOn: row.receivedOn,
      status: row.status,
    };
  });
}

/** The fee items and price lists a bursar maintains. */
export async function listFeeStructure() {
  const session = await requireActiveSession();
  if (!session.permissions.has(P.FEES_STRUCTURE_MANAGE) && !session.permissions.has(P.FEES_VIEW)) {
    return { items: [], schedules: [], canManage: false };
  }

  const data = await session.transaction(async (db) => {
    const items = await db.feeItem.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, description: true, isOptional: true, isActive: true },
    });
    const schedules = await db.feeSchedule.findMany({
      orderBy: [{ effectiveFrom: 'desc' }],
      take: 100,
      select: {
        id: true,
        name: true,
        currency: true,
        status: true,
        effectiveFrom: true,
        term: { select: { name: true } },
        classGroup: { select: { code: true } },
        lines: {
          orderBy: { feeItem: { code: 'asc' } },
          select: {
            id: true,
            amount: true,
            isMandatory: true,
            feeItem: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    return { items, schedules };
  });

  return {
    items: data.items,
    schedules: data.schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      currency: schedule.currency,
      status: schedule.status,
      effectiveFrom: schedule.effectiveFrom,
      termName: schedule.term.name,
      classCode: schedule.classGroup?.code ?? null,
      lines: schedule.lines.map((line) => ({
        id: line.id,
        feeItemId: line.feeItem.id,
        code: line.feeItem.code,
        name: line.feeItem.name,
        amount: amount(String(line.amount)),
        isMandatory: line.isMandatory,
      })),
      total:
        schedule.lines.length === 0
          ? ZERO
          : add(...schedule.lines.map((line) => amount(String(line.amount)))),
    })),
    canManage: session.permissions.has(P.FEES_STRUCTURE_MANAGE),
  };
}

/** Refunds awaiting a decision, for whoever holds the approving permission. */
export async function listRefunds() {
  const session = await requireActiveSession();
  if (!session.permissions.has(P.FEES_VIEW)) return { rows: [], canDecide: false, canRequest: false };

  const rows = await session.transaction((db) =>
    db.refund.findMany({
      orderBy: { requestedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        amount: true,
        currency: true,
        reason: true,
        status: true,
        requestedAt: true,
        requestedByMembershipId: true,
        decisionNote: true,
        payment: { select: { receiptNo: true, student: { select: { reference: true } } } },
      },
    }),
  );

  return {
    rows: rows.map((row) => ({
      id: row.id,
      amount: amount(String(row.amount)),
      currency: row.currency,
      reason: row.reason,
      status: row.status,
      requestedAt: row.requestedAt,
      // Surfaced so a screen can hide the approve button from the person who asked. The
      // database refuses it regardless — this only saves them a pointless click.
      requestedByMembershipId: row.requestedByMembershipId,
      decisionNote: row.decisionNote,
      receiptNo: row.payment.receiptNo,
      reference: row.payment.student.reference,
    })),
    canDecide: session.permissions.has(P.PAYMENT_REFUND_APPROVE),
    canRequest: session.permissions.has(P.PAYMENT_REFUND),
    membershipId: session.membershipId,
  };
}

/**
 * The classes a fee run can be raised for.
 *
 * <p>Deliberately not `listClasses()`. That one is gated on `CLASS_VIEW`, which a **bursar does
 * not hold** — and calling it from the fees page meant the bursar, the one person whose job this
 * module is, could not open it at all. The page 500'd with a permission error naming a
 * permission the screen never mentions.
 *
 * <p>The right gate is the one for the thing being done: if you may raise invoices for a class,
 * you may see the list of classes to raise them for. `raiseInvoicesAction` re-checks
 * `INVOICE_CREATE` and resolves the class through the scoped client, so this list is a
 * convenience for the form and not the authorization.
 */
export async function classesForFees(): Promise<Array<{ id: string; code: string; name: string }>> {
  const session = await requireActiveSession();

  const mayUse =
    session.permissions.has(P.INVOICE_CREATE) || session.permissions.has(P.FEES_STRUCTURE_MANAGE);
  if (!mayUse) return [];

  return session.transaction((db) =>
    db.classGroup.findMany({
      orderBy: [{ yearLevel: 'asc' }, { code: 'asc' }],
      take: 300,
      select: { id: true, code: true, name: true },
    }),
  );
}

/** Terms a fee run or a price list can name. Same reasoning as {@link classesForFees}. */
export async function termsForFees(): Promise<Array<{ id: string; label: string }>> {
  const session = await requireActiveSession();

  const mayUse =
    session.permissions.has(P.INVOICE_CREATE) ||
    session.permissions.has(P.FEES_STRUCTURE_MANAGE) ||
    session.permissions.has(P.FEES_VIEW);
  if (!mayUse) return [];

  const terms = await session.transaction((db) =>
    db.term.findMany({
      where: { status: { in: ['PLANNED', 'ACTIVE'] } },
      orderBy: [{ startsOn: 'desc' }],
      take: 20,
      select: { id: true, name: true, academicYear: { select: { name: true } } },
    }),
  );

  return terms.map((term) => ({ id: term.id, label: `${term.academicYear.name} — ${term.name}` }));
}

/**
 * The children a payment can be recorded against.
 *
 * <p>Deliberately not the students module's own list. That one is gated on `STUDENT_READ` and
 * scoped by roster reach, which is right for the admissions screens and wrong here: a bursar
 * holds no roster permission at all and must still be able to take money for any child in the
 * school. Reaching into `getStudents()` from the fee pages is exactly the mistake that made
 * `/fees` return a 500 to the one person whose job it is.
 *
 * <p>The gate is the thing being done. `recordPaymentAction` re-checks `PAYMENT_RECORD` and
 * resolves the child through the scoped client, so this list is a convenience for the form and
 * never the authorization.
 */
export async function studentsForFees(): Promise<
  Array<{ id: string; reference: string; firstName: string; lastName: string; preferredName: string | null }>
> {
  const session = await requireActiveSession();

  const mayUse =
    session.permissions.has(P.PAYMENT_RECORD) ||
    session.permissions.has(P.INVOICE_CREATE) ||
    session.permissions.has(P.PAYMENT_REFUND);
  if (!mayUse) return [];

  return session.transaction((db) =>
    db.student.findMany({
      where: { status: { in: ['PROSPECTIVE', 'ENROLLED', 'ACTIVE'] } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 1000,
      select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true },
    }),
  );
}
