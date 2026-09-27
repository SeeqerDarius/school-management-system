import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * Money, against the database that holds it.
 *
 * <p>AGENTS.md §7 requires, for money: "a test asserting exact BigDecimal values, including
 * rounding and a partial payment". That is the section below called **a partial payment**, and it
 * asserts exact `numeric(19,4)` values rather than approximate ones — because the failure this
 * guards against is not a crash, it is a family being told they owe a pesewa they have paid.
 *
 * <p>The rest proves the invariants the schema language cannot state: an issued invoice cannot be
 * edited (I-3), an invoice adds up (the I-4 pattern), nothing is settled twice, currencies must
 * agree, and a refund cannot be approved by whoever asked for it.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tests/db requires DATABASE_URL to point at a disposable PostgreSQL database.');
}

const suffix = randomUUID().slice(0, 8);
const slugA = `fees-a-${suffix}`;
const slugB = `fees-b-${suffix}`;
const restrictedPassword = randomUUID();

let restricted: PrismaClient;
let tenantA: string;
let tenantB: string;
let yearA: string;
let termA: string;
let termB: string;
let childA: string;
let childB: string;
let itemTuition: string;
let itemLevy: string;
let bursar: string;
let financeManager: string;

const D = (value: string) => value;
const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function restrictedUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = 'sankofa_app';
  url.password = restrictedPassword;
  return url.toString();
}

async function asTenant<T>(tenantId: string | null, work: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return restricted.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${''}, true)`;
    return work(tx as never);
  });
}

const school = (slug: string) =>
  db.tenant.create({
    data: {
      slug,
      legalName: slug,
      displayName: slug,
      status: 'ACTIVE',
      countryCode: 'GH',
      defaultCurrency: 'GHS',
    },
  });

const campusOf: Record<string, string> = {};

const child = (tenantId: string, reference: string) =>
  db.student.create({
    data: {
      tenantId,
      campusId: campusOf[tenantId] as string,
      reference,
      firstName: 'Ama',
      lastName: 'Mensah',
      dateOfBirth: new Date('2015-04-01'),
      gender: 'FEMALE',
      status: 'ENROLLED',
    },
  });

/**
 * A child nobody else's test is using.
 *
 * <p>`invoice_one_live_per_student_term` allows exactly one live invoice per child per term, and
 * that is a real rule — a family billed twice pays twice. So a test that needs an invoice needs
 * its own child, rather than the suite tripping over its own fixtures and calling it a failure.
 */
let childCounter = 0;
async function freshChild(): Promise<string> {
  childCounter += 1;
  return (await child(tenantA, `FX${childCounter}-${suffix}`)).id;
}

/**
 * A DRAFT invoice with the given line amounts, totals filled in correctly.
 *
 * <p>Built in one `create` so the deferred total check sees a finished invoice at commit — which
 * is the point of it being deferred.
 */
async function draftInvoice(
  studentId: string,
  lineAmounts: string[],
  currency = 'GHS',
  termId?: string,
) {
  const subtotal = lineAmounts
    .reduce((sum, value) => sum + Math.round(Number(value) * 10000), 0)
    .toString();
  const total = (Number(subtotal) / 10000).toFixed(4);

  return db.invoice.create({
    data: {
      tenantId: tenantA,
      studentId,
      academicYearId: yearA,
      termId: termId ?? termA,
      currency,
      subtotal: total,
      discountTotal: '0',
      total,
      lines: {
        // `tenantId` is derived from the parent through the composite relation, not passed.
        create: lineAmounts.map((amount, index) => ({
          feeItemId: index === 0 ? itemTuition : itemLevy,
          description: index === 0 ? 'Tuition' : 'PTA levy',
          quantity: 1,
          unitAmount: amount,
          discount: '0',
          lineTotal: amount,
        })),
      },
    },
    select: { id: true, total: true },
  });
}

let invoiceCounter = 0;
async function issuedInvoice(
  studentId: string,
  lineAmounts: string[],
  currency = 'GHS',
  termId?: string,
) {
  const invoice = await draftInvoice(studentId, lineAmounts, currency, termId);
  invoiceCounter += 1;
  return db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'ISSUED',
      invoiceNo: `INV-${suffix}-${String(invoiceCounter).padStart(4, '0')}`,
      issuedOn: on('2026-09-01'),
      dueOn: on('2026-09-30'),
    },
    select: { id: true, total: true, invoiceNo: true },
  });
}

let receiptCounter = 0;
async function payment(studentId: string, amount: string, currency = 'GHS') {
  receiptCounter += 1;
  return db.payment.create({
    data: {
      tenantId: tenantA,
      receiptNo: `RCT-${suffix}-${String(receiptCounter).padStart(4, '0')}`,
      studentId,
      method: 'CASH',
      amount,
      currency,
      receivedOn: on('2026-09-05'),
      receivedByMembershipId: bursar,
    },
    select: { id: true, amount: true },
  });
}

/** What an invoice has been settled by, straight from the database. */
async function settledOn(invoiceId: string): Promise<string> {
  const [row] = await db.$queryRaw<{ settled: string }[]>`
    SELECT (
      coalesce((SELECT sum(a."amount") FROM payment_allocation a WHERE a."invoiceId" = ${invoiceId}::uuid), 0)
      + coalesce((SELECT sum(c."amount") FROM credit_note c WHERE c."invoiceId" = ${invoiceId}::uuid), 0)
    )::text AS settled`;
  return row?.settled ?? '0';
}

beforeAll(async () => {
  await db.$executeRawUnsafe(
    `ALTER ROLE sankofa_app LOGIN PASSWORD '${restrictedPassword.replace(/'/g, "''")}'`,
  );
  restricted = new PrismaClient({ datasourceUrl: restrictedUrl() });

  tenantA = (await school(slugA)).id;
  tenantB = (await school(slugB)).id;

  // A student needs a campus on this schema, and the reference to it carries the tenant.
  for (const tenantId of [tenantA, tenantB]) {
    const campus = await db.campus.create({ data: { tenantId, code: 'MAIN', name: 'Main' } });
    campusOf[tenantId] = campus.id;
  }

  yearA = (
    await db.academicYear.create({
      data: {
        tenantId: tenantA,
        code: `2026-${suffix}`,
        name: '2026/2027',
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-07-31'),
        status: 'ACTIVE',
      },
    })
  ).id;

  termA = (
    await db.term.create({
      data: {
        tenantId: tenantA,
        academicYearId: yearA,
        sequence: 1,
        code: `T1-${suffix}`,
        name: 'First Term',
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2026-12-15'),
        status: 'ACTIVE',
      },
    })
  ).id;

  termB = (
    await db.term.create({
      data: {
        tenantId: tenantA,
        academicYearId: yearA,
        sequence: 2,
        code: `T2-${suffix}`,
        name: 'Second Term',
        startsOn: new Date('2027-01-05'),
        endsOn: new Date('2027-04-10'),
        status: 'PLANNED',
      },
    })
  ).id;

  childA = (await child(tenantA, `FA-${suffix}`)).id;
  childB = (await child(tenantB, `FB-${suffix}`)).id;

  itemTuition = (
    await db.feeItem.create({ data: { tenantId: tenantA, code: `TUI${suffix}`, name: 'Tuition' } })
  ).id;
  itemLevy = (
    await db.feeItem.create({ data: { tenantId: tenantA, code: `PTA${suffix}`, name: 'PTA levy' } })
  ).id;

  const users = await Promise.all([
    db.appUser.create({ data: { email: `bursar-${suffix}@example.test`, fullName: 'A Bursar' } }),
    db.appUser.create({ data: { email: `fm-${suffix}@example.test`, fullName: 'A Finance Manager' } }),
  ]);
  bursar = (
    await db.membership.create({
      data: { tenantId: tenantA, userId: users[0].id, principalType: 'STAFF', status: 'ACTIVE' },
    })
  ).id;
  financeManager = (
    await db.membership.create({
      data: { tenantId: tenantA, userId: users[1].id, principalType: 'STAFF', status: 'ACTIVE' },
    })
  ).id;
});

afterAll(async () => {
  await restricted?.$disconnect();
  const tenants = { in: [tenantA, tenantB] };

  // Every financial row refuses deletion by design. Lifted for the length of the teardown and
  // put straight back — nothing the application runs can do this.
  await db.$executeRaw`ALTER TABLE payment DISABLE TRIGGER payment_is_immutable_once_recorded`;
  await db.$executeRaw`ALTER TABLE invoice DISABLE TRIGGER invoice_is_immutable_once_issued`;
  await db.$executeRaw`ALTER TABLE invoice_line DISABLE TRIGGER invoice_line_requires_draft`;
  await db.$executeRaw`ALTER TABLE invoice DISABLE TRIGGER invoice_totals_match_lines`;
  await db.$executeRaw`ALTER TABLE invoice_line DISABLE TRIGGER invoice_line_totals_match_header`;

  await db.refund.deleteMany({ where: { tenantId: tenants } });
  await db.paymentAllocation.deleteMany({ where: { tenantId: tenants } });
  await db.creditNote.deleteMany({ where: { tenantId: tenants } });
  await db.payment.deleteMany({ where: { tenantId: tenants } });
  await db.invoiceLine.deleteMany({ where: { tenantId: tenants } });
  await db.invoice.deleteMany({ where: { tenantId: tenants } });

  await db.$executeRaw`ALTER TABLE invoice_line ENABLE TRIGGER invoice_line_totals_match_header`;
  await db.$executeRaw`ALTER TABLE invoice ENABLE TRIGGER invoice_totals_match_lines`;
  await db.$executeRaw`ALTER TABLE invoice_line ENABLE TRIGGER invoice_line_requires_draft`;
  await db.$executeRaw`ALTER TABLE invoice ENABLE TRIGGER invoice_is_immutable_once_issued`;
  await db.$executeRaw`ALTER TABLE payment ENABLE TRIGGER payment_is_immutable_once_recorded`;

  await db.feeScheduleLine.deleteMany({ where: { tenantId: tenants } });
  await db.feeSchedule.deleteMany({ where: { tenantId: tenants } });
  await db.feeItem.deleteMany({ where: { tenantId: tenants } });
  await db.student.deleteMany({ where: { tenantId: tenants } });
  await db.membership.deleteMany({ where: { tenantId: tenants } });
  await db.appUser.deleteMany({ where: { email: { contains: suffix } } });
  await db.term.deleteMany({ where: { tenantId: tenants } });
  await db.academicYear.deleteMany({ where: { tenantId: tenants } });
  await db.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
  await db.$executeRawUnsafe('ALTER ROLE sankofa_app NOLOGIN PASSWORD NULL');
  await db.$disconnect();
});

// =====================================================================================
// A partial payment — AGENTS.md §7, exact values
// =====================================================================================

describe('a partial payment', () => {
  it('settles exactly what was paid and leaves exactly what is owed', async () => {
    // ₵1,200.00 tuition + ₵150.50 levy = ₵1,350.50. A family pays ₵500.
    const student = await freshChild();
    const invoice = await issuedInvoice(student, ['1200.00', '150.50']);
    expect(invoice.total.toFixed(4)).toBe('1350.5000');

    const received = await payment(student, '500.00');
    await db.paymentAllocation.create({
      data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '500.00' },
    });

    // Exact, to the stored scale. Not "about 850".
    expect(await settledOn(invoice.id)).toBe('500.0000');

    const [row] = await db.$queryRaw<{ outstanding: string }[]>`
      SELECT (i."total" - coalesce(sum(a."amount"), 0))::text AS outstanding
        FROM invoice i LEFT JOIN payment_allocation a ON a."invoiceId" = i.id
       WHERE i.id = ${invoice.id}::uuid GROUP BY i."total"`;
    expect(row?.outstanding).toBe('850.5000');
  });

  it('takes a second payment to the exact remainder without drift', async () => {
    const student = await freshChild();
    const invoice = await issuedInvoice(student, ['1000.00', '0.10']);
    const first = await payment(student, '333.33');
    const second = await payment(student, '333.33');
    const third = await payment(student, '333.44');

    for (const [p, amount] of [
      [first, '333.33'],
      [second, '333.33'],
      [third, '333.44'],
    ] as const) {
      await db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: p.id, invoiceId: invoice.id, amount },
      });
    }

    // 333.33 + 333.33 + 333.44 = 1000.10 exactly. In floating point this is 1000.0999999999999.
    expect(await settledOn(invoice.id)).toBe('1000.1000');
    expect(invoice.total.toFixed(4)).toBe('1000.1000');
  });

  it('holds a four-place amount without rounding it away', async () => {
    // A 7.5% levy on ₵1,234.56 is ₵92.5920 — four places, and the column has to keep them.
    const invoice = await issuedInvoice(await freshChild(), ['92.5920']);
    expect(invoice.total.toFixed(4)).toBe('92.5920');
  });
});

// =====================================================================================
// I-3 — an issued invoice is a document, not a row somebody can edit
// =====================================================================================

describe('an issued invoice is immutable', () => {
  it('refuses a change to its total', async () => {
    const invoice = await issuedInvoice(await freshChild(), ['1200.00']);
    await expect(
      db.invoice.update({ where: { id: invoice.id }, data: { total: '1.00', subtotal: '1.00' } }),
    ).rejects.toThrow(/an issued invoice cannot be changed/);
  });

  it('refuses a change to its lines — where the money actually is', async () => {
    const invoice = await issuedInvoice(await freshChild(), ['1200.00']);
    const line = await db.invoiceLine.findFirstOrThrow({ where: { invoiceId: invoice.id } });

    await expect(
      db.invoiceLine.update({ where: { id: line.id }, data: { unitAmount: '1.00', lineTotal: '1.00' } }),
    ).rejects.toThrow(/lines of an issued invoice/);

    await expect(db.invoiceLine.delete({ where: { id: line.id } })).rejects.toThrow(
      /lines of an issued invoice/,
    );
  });

  it('refuses going back to draft, and refuses deletion', async () => {
    const invoice = await issuedInvoice(await freshChild(), ['1200.00']);
    await expect(
      db.invoice.update({
        where: { id: invoice.id },
        data: { status: 'DRAFT', invoiceNo: null, issuedOn: null },
      }),
    ).rejects.toThrow(/cannot go back to draft/);

    await expect(db.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it('refuses cancellation once money has been allocated — credit it instead', async () => {
    const student = await freshChild();
    const invoice = await issuedInvoice(student, ['1200.00']);
    const received = await payment(student, '100.00');
    await db.paymentAllocation.create({
      data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '100.00' },
    });

    await expect(
      db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledReason: 'Raised against the wrong child',
        },
      }),
    ).rejects.toThrow(/cannot be cancelled/);
  });

  it('allows cancellation while nothing has been paid', async () => {
    const invoice = await issuedInvoice(await freshChild(), ['1200.00']);
    await expect(
      db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledReason: 'Raised against the wrong child',
        },
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('refuses a cancellation with no reason worth reading', async () => {
    const invoice = await issuedInvoice(await freshChild(), ['1200.00']);
    await expect(
      db.invoice.update({
        where: { id: invoice.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: 'oops' },
      }),
    ).rejects.toThrow(/invoice_status_coherent/);
  });

  it('is immutable to the application role too, not only to the owner', async () => {
    // The owner bypasses row-level security; it does not bypass a trigger.
    const invoice = await issuedInvoice(await freshChild(), ['1200.00']);
    await expect(
      asTenant(tenantA, (tx) =>
        tx.invoice.update({ where: { id: invoice.id }, data: { total: '1.00', subtotal: '1.00' } }),
      ),
    ).rejects.toThrow(/an issued invoice cannot be changed/);
  });
});

// =====================================================================================
// The I-4 pattern — the document adds up, checked at commit
// =====================================================================================

describe('an invoice adds up', () => {
  it('refuses a header that disagrees with its own lines', async () => {
    await expect(
      db.invoice.create({
        data: {
          tenantId: tenantA,
          studentId: childA,
          academicYearId: yearA,
          termId: termA,
          currency: 'GHS',
          // Says 5,000; the line says 1,200.
          subtotal: '5000.00',
          discountTotal: '0',
          total: '5000.00',
          lines: {
            create: [
              {
                feeItemId: itemTuition,
                description: 'Tuition',
                quantity: 1,
                unitAmount: '1200.00',
                discount: '0',
                lineTotal: '1200.00',
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/does not add up/);
  });

  it('refuses a line whose own total is not its own parts', async () => {
    await expect(
      db.invoice.create({
        data: {
          tenantId: tenantA,
          studentId: childA,
          academicYearId: yearA,
          termId: termA,
          currency: 'GHS',
          subtotal: '1200.00',
          discountTotal: '0',
          total: '1200.00',
          lines: {
            create: [
              {
                feeItemId: itemTuition,
                description: 'Tuition',
                quantity: 2,
                unitAmount: '600.00',
                discount: '0',
                // 2 × 600 is 1,200, not 999.
                lineTotal: '999.00',
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/invoice_line_total_is_its_parts/);
  });

  it('refuses a total that is not subtotal less discount', async () => {
    await expect(
      db.invoice.create({
        data: {
          tenantId: tenantA,
          studentId: childA,
          academicYearId: yearA,
          termId: termA,
          currency: 'GHS',
          subtotal: '1200.00',
          discountTotal: '200.00',
          total: '1200.00',
        },
      }),
    ).rejects.toThrow(/invoice_total_is_subtotal_less_discount/);
  });

  it('accepts an invoice built across several statements, because the check is deferred', async () => {
    // The whole reason for DEFERRABLE INITIALLY DEFERRED: an eager check fails on the header,
    // which has no lines yet.
    const id = await db.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId: tenantA,
          studentId: childA,
          academicYearId: yearA,
          termId: termA,
          currency: 'GHS',
          subtotal: '1200.00',
          discountTotal: '0',
          total: '1200.00',
        },
        select: { id: true },
      });

      await tx.invoiceLine.create({
        data: {
          tenantId: tenantA,
          invoiceId: invoice.id,
          feeItemId: itemTuition,
          description: 'Tuition',
          quantity: 1,
          unitAmount: '1200.00',
          discount: '0',
          lineTotal: '1200.00',
        },
      });

      return invoice.id;
    });

    expect(id).toBeTruthy();
  });
});

// =====================================================================================
// Nothing is settled twice
// =====================================================================================

describe('settlement limits', () => {
  it('refuses allocating more of a payment than was received', async () => {
    // One child, two TERMS. It has to be the same child — a payment and an invoice for
    // different children is refused by a different rule, which would make this test pass for
    // the wrong reason. The limit under test is the payment's, not the invoice's: neither
    // allocation exceeds its invoice, and together they exceed the ₵500 received.
    const student = await freshChild();
    const invoiceOne = await issuedInvoice(student, ['1000.00']);
    const invoiceTwo = await issuedInvoice(student, ['1000.00'], 'GHS', termB);
    const received = await payment(student, '500.00');

    await expect(
      db.$transaction(async (tx) => {
        await tx.paymentAllocation.create({
          data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoiceOne.id, amount: '400.00' },
        });
        await tx.paymentAllocation.create({
          data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoiceTwo.id, amount: '400.00' },
        });
      }),
    ).rejects.toThrow(/has been allocated from it/);
  });

  it('refuses settling an invoice for more than it is worth', async () => {
    const student = await freshChild();
    const invoice = await issuedInvoice(student, ['1000.00']);
    const received = await payment(student, '1500.00');

    await expect(
      db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '1500.00' },
      }),
    ).rejects.toThrow(/have been applied to it/);
  });

  it('counts a credit note towards the limit', async () => {
    const student = await freshChild();
    const invoice = await issuedInvoice(student, ['1000.00']);
    await db.creditNote.create({
      data: {
        tenantId: tenantA,
        invoiceId: invoice.id,
        amount: '600.00',
        currency: 'GHS',
        reason: 'Hardship award for the term',
        issuedOn: on('2026-09-10'),
        issuedByMembershipId: financeManager,
      },
    });

    const received = await payment(student, '500.00');
    // 600 credited + 500 paid is 1,100 against a 1,000 invoice.
    await expect(
      db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '500.00' },
      }),
    ).rejects.toThrow(/have been applied to it/);

    // And the ₵400 that is genuinely owed still goes through.
    await expect(
      db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '400.00' },
      }),
    ).resolves.toBeTruthy();
    expect(await settledOn(invoice.id)).toBe('1000.0000');
  });
});

// =====================================================================================
// Two documents that touch each other have to agree
// =====================================================================================

describe('coherence between documents', () => {
  it('refuses allocating one currency to another', async () => {
    // Arithmetically fine, financially nonsense, and nothing else in the schema would notice.
    const student = await freshChild();
    const invoice = await issuedInvoice(student, ['1000.00'], 'USD');
    const received = await payment(student, '1000.00', 'GHS');

    await expect(
      db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '1000.00' },
      }),
    ).rejects.toThrow(/cannot allocate a GHS payment to a USD invoice/);
  });

  it('refuses paying one child’s invoice with another child’s money', async () => {
    const invoice = await issuedInvoice(await freshChild(), ['1000.00']);
    const received = await payment(await freshChild(), '1000.00');

    await expect(
      db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '1000.00' },
      }),
    ).rejects.toThrow(/different children/);
  });

  it('refuses paying a draft invoice', async () => {
    const student = await freshChild();
    const invoice = await draftInvoice(student, ['1000.00']);
    const received = await payment(student, '1000.00');

    await expect(
      db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '1000.00' },
      }),
    ).rejects.toThrow(/only an issued invoice can be paid/);
  });

  it('refuses settling anything with a reversed payment', async () => {
    const student = await freshChild();
    const invoice = await issuedInvoice(student, ['1000.00']);
    const received = await payment(student, '1000.00');
    await db.payment.update({
      where: { id: received.id },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedReason: 'Cheque returned unpaid' },
    });

    await expect(
      db.paymentAllocation.create({
        data: { tenantId: tenantA, paymentId: received.id, invoiceId: invoice.id, amount: '1000.00' },
      }),
    ).rejects.toThrow(/a reversed payment cannot settle anything/);
  });

  it('refuses an electronic payment with no reference to reconcile it by', async () => {
    await expect(
      db.payment.create({
        data: {
          tenantId: tenantA,
          studentId: childA,
          method: 'MOBILE_MONEY',
          amount: '100.00',
          currency: 'GHS',
          receivedOn: on('2026-09-05'),
          receivedByMembershipId: bursar,
        },
      }),
    ).rejects.toThrow(/payment_electronic_has_a_reference/);
  });
});

describe('a recorded payment is immutable', () => {
  it('refuses a change to its amount', async () => {
    const received = await payment(childA, '500.00');
    await expect(
      db.payment.update({ where: { id: received.id }, data: { amount: '5000.00' } }),
    ).rejects.toThrow(/a recorded payment cannot be changed/);
  });

  it('is never deleted', async () => {
    const received = await payment(childA, '500.00');
    await expect(db.payment.delete({ where: { id: received.id } })).rejects.toThrow(
      /a payment is never deleted/,
    );
  });

  it('allows the reversal that replaces an edit', async () => {
    const received = await payment(childA, '500.00');
    await expect(
      db.payment.update({
        where: { id: received.id },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedReason: 'Duplicate receipt issued' },
      }),
    ).resolves.toMatchObject({ status: 'REVERSED' });
  });
});

// =====================================================================================
// Maker-checker — spec 134
// =====================================================================================

describe('a refund cannot be approved by whoever asked for it', () => {
  it('refuses a self-approval at the database, not just in the screen', async () => {
    // The assertion this constraint exists for. One person who can both request and approve a
    // refund can pay themselves, and a permission check lives in one action while this holds
    // against a script, a support query and a code path nobody has written yet.
    const received = await payment(childA, '500.00');
    const refund = await db.refund.create({
      data: {
        tenantId: tenantA,
        paymentId: received.id,
        amount: '500.00',
        currency: 'GHS',
        reason: 'Child withdrew before the term started',
        requestedByMembershipId: bursar,
      },
    });

    await expect(
      db.refund.update({
        where: { id: refund.id },
        data: { status: 'APPROVED', decidedByMembershipId: bursar, decidedAt: new Date() },
      }),
    ).rejects.toThrow(/refund_is_not_self_approved/);
  });

  it('allows a second person to approve it', async () => {
    const received = await payment(childA, '500.00');
    const refund = await db.refund.create({
      data: {
        tenantId: tenantA,
        paymentId: received.id,
        amount: '500.00',
        currency: 'GHS',
        reason: 'Child withdrew before the term started',
        requestedByMembershipId: bursar,
      },
    });

    await expect(
      db.refund.update({
        where: { id: refund.id },
        data: { status: 'APPROVED', decidedByMembershipId: financeManager, decidedAt: new Date() },
      }),
    ).resolves.toMatchObject({ status: 'APPROVED' });
  });

  it('refuses a decision with nobody recorded as having made it', async () => {
    const received = await payment(childA, '500.00');
    const refund = await db.refund.create({
      data: {
        tenantId: tenantA,
        paymentId: received.id,
        amount: '500.00',
        currency: 'GHS',
        reason: 'Child withdrew before the term started',
        requestedByMembershipId: bursar,
      },
    });

    await expect(
      db.refund.update({ where: { id: refund.id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow(/refund_decision_coherent/);
  });
});

// =====================================================================================
// Tenant isolation — AGENTS.md §7 for every tenant-owned table
// =====================================================================================

describe('one school cannot reach another school’s money', () => {
  it('reads only its own invoices and payments', async () => {
    await issuedInvoice(await freshChild(), ['1000.00']);
    await payment(await freshChild(), '100.00');

    const invoices = await asTenant(tenantA, (tx) => tx.invoice.findMany());
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices.every((row) => row.tenantId === tenantA)).toBe(true);

    const payments = await asTenant(tenantA, (tx) => tx.payment.findMany());
    expect(payments.every((row) => row.tenantId === tenantA)).toBe(true);
  });

  it('is a real control — school B sees none of school A’s, and its own is empty', async () => {
    // The positive control, inverted: B genuinely has no invoices, so the assertion that A's
    // are invisible is backed by B being able to query at all.
    const seen = await asTenant(tenantB, (tx) => tx.invoice.findMany());
    expect(seen).toHaveLength(0);

    const students = await asTenant(tenantB, (tx) => tx.student.findMany());
    expect(students.map((s) => s.id)).toEqual([childB]);
  });

  it('cannot invoice another school’s child while claiming its own tenant', async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        tx.invoice.create({
          data: {
            tenantId: tenantA,
            studentId: childB,
            academicYearId: yearA,
            termId: termA,
            currency: 'GHS',
            subtotal: '0',
            discountTotal: '0',
            total: '0',
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('one live invoice per child per term', () => {
  it('refuses a second, because a family billed twice pays twice', async () => {
    const lonelyChild = await freshChild();
    await issuedInvoice(lonelyChild, ['1000.00']);

    await expect(draftInvoice(lonelyChild, ['1000.00'])).rejects.toThrow();
  });

  it('allows a replacement once the first is cancelled', async () => {
    const movedChild = await freshChild();
    const first = await issuedInvoice(movedChild, ['1000.00']);
    await db.invoice.update({
      where: { id: first.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledReason: 'Billed on the wrong price list',
      },
    });

    await expect(draftInvoice(movedChild, ['1200.00'])).resolves.toBeTruthy();
  });
});

describe('amounts are what they say', () => {
  it('refuses a negative amount anywhere', async () => {
    await expect(payment(childA, '-100.00')).rejects.toThrow(/payment_amount_positive/);
  });

  it('refuses a currency that is not an ISO code', async () => {
    await expect(payment(childA, '100.00', 'gh')).rejects.toThrow();
  });

  it('keeps four decimal places through a round trip', async () => {
    const received = await payment(childA, '1234.5678');
    const back = await db.payment.findFirstOrThrow({ where: { id: received.id } });
    expect(back.amount.toFixed(4)).toBe(D('1234.5678'));
  });
});
