/**
 * A school you can sign into as eight different people.
 *
 *   npm run db:demo
 *
 * <p>`db:seed` gives you one administrator, which is enough to prove the app runs and not
 * enough to see what it does. Most of this product's rules are about **who sees what**, and a
 * single account cannot show you any of them: a class teacher who cannot see a fee balance
 * looks identical to a fee module that is broken, until you sign in as somebody else and it is
 * there.
 *
 * <p>So this creates a cast — administrator, headmaster, bursar, finance manager, registrar,
 * two class teachers and a parent — and enough data for them to disagree about: two classes,
 * eight children, a guardian linked to two of them, a register that has been taken, a live
 * price list, issued invoices and a partial payment.
 *
 * <h2>Refuses anything but a local database</h2>
 * These accounts share a published password. Seeding them into a reachable deployment would
 * hand anyone who reads this file a working sign-in to a school's records, so the host is
 * checked here as well as in the npm script — `npm run` is not a security boundary, and
 * somebody will eventually run this file directly.
 *
 * <h2>Idempotent</h2>
 * Safe to re-run. Everything is upserted or skipped if present, so a database you have been
 * clicking around in can be topped up without doubling. It needs `db:seed` to have run first,
 * for the permission catalogue and the role templates.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { add, amount, formatMoney, ZERO } from '../src/lib/money';

const db = new PrismaClient();

/**
 * One password for the whole cast.
 *
 * <p>Published, obviously fake, and shaped so nobody mistakes it for a real one. Per-account
 * passwords would be marginally more realistic and would mean eight things to keep track of
 * while you are trying to look at a screen.
 */
const DEMO_PASSWORD = 'Demo!Sankofa2026';

const TENANT_SLUG = 'greenfield';

/** email → [full name, role code, principal type] */
const CAST = [
  ['admin@greenfield.example', 'Ama Mensah', 'SCHOOL_ADMIN', 'STAFF'],
  ['head@greenfield.example', 'Kwame Asante', 'HEADMASTER', 'STAFF'],
  ['bursar@greenfield.example', 'Abena Owusu', 'BURSAR', 'STAFF'],
  ['finance@greenfield.example', 'Yaw Boateng', 'FINANCE_MANAGER', 'STAFF'],
  ['registrar@greenfield.example', 'Efua Adjei', 'REGISTRAR', 'STAFF'],
  ['teacher.b5a@greenfield.example', 'Kofi Tetteh', 'CLASS_TEACHER', 'TEACHER'],
  ['teacher.b5b@greenfield.example', 'Adwoa Nartey', 'CLASS_TEACHER', 'TEACHER'],
  ['parent@greenfield.example', 'Akosua Quaye', 'GUARDIAN', 'GUARDIAN'],
] as const;

/** first, last, date of birth, class, gender */
const CHILDREN = [
  ['Ama', 'Mensah', '2015-04-01', 'B5A', 'FEMALE'],
  ['Kofi', 'Owusu', '2015-07-11', 'B5A', 'MALE'],
  ['Esi', 'Boateng', '2015-02-23', 'B5A', 'FEMALE'],
  ['Kwesi', 'Adjei', '2015-11-05', 'B5A', 'MALE'],
  ['Akua', 'Tetteh', '2016-01-19', 'B5B', 'FEMALE'],
  ['Yaa', 'Nartey', '2015-09-30', 'B5B', 'FEMALE'],
  ['Kojo', 'Quaye', '2015-06-14', 'B5B', 'MALE'],
  ['Abena', 'Danso', '2016-03-08', 'B5B', 'FEMALE'],
] as const;

function refuseIfNotLocal() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // Unparseable is not a licence to proceed.
  }

  const LOCAL = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
  if (!LOCAL.has(host)) {
    console.error(
      `\nRefusing to seed demo accounts into "${host || '<no usable database URL>'}".\n\n` +
        'These accounts share a password that is written in prisma/seed-demo.ts, so seeding\n' +
        "them anywhere reachable hands a sign-in to whoever reads the file. Point DATABASE_URL\n" +
        'at a local PostgreSQL.\n',
    );
    process.exit(1);
  }
}

const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The most recent weekday on or before today, so the register is for a day that has happened. */
function lastSchoolDay(within: { startsOn: Date; endsOn: Date }): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let day = today > within.endsOn ? new Date(within.endsOn) : today;
  if (day < within.startsOn) day = new Date(within.startsOn);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return day;
}

async function main() {
  refuseIfNotLocal();

  const tenant = await db.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    console.error('\nNo demo school found. Run `npm run db:seed` first.\n');
    process.exit(1);
  }

  const campus = await db.campus.findFirst({ where: { tenantId: tenant.id } });
  if (!campus) {
    console.error('\nThat school has no campus. Run `npm run db:seed` first.\n');
    process.exit(1);
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  console.log(`Seeding demo accounts into ${tenant.displayName}…`);

  // ---- the cast --------------------------------------------------------------------------
  const memberships = new Map<string, string>();

  for (const [email, fullName, roleCode, principalType] of CAST) {
    const user = await db.appUser.upsert({
      where: { email },
      create: { email, fullName, status: 'ACTIVE', emailVerified: true, passwordHash: hash },
      update: { fullName, status: 'ACTIVE', passwordHash: hash },
    });

    const membership = await db.membership.upsert({
      where: {
        tenantId_userId_principalType: { tenantId: tenant.id, userId: user.id, principalType },
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        status: 'ACTIVE',
        principalType,
        startedOn: new Date(),
        acceptedAt: new Date(),
      },
      update: { status: 'ACTIVE' },
    });
    memberships.set(email, membership.id);

    const role = await db.role.findFirst({
      where: { code: roleCode, tenantId: null },
      select: { id: true },
    });
    if (!role) {
      console.error(`  ! no system role ${roleCode} — is the catalogue seeded?`);
      continue;
    }
    await db.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      create: { membershipId: membership.id, roleId: role.id },
      update: {},
    });
  }
  console.log(`  ${CAST.length} accounts, one password`);

  // ---- calendar --------------------------------------------------------------------------
  let year = await db.academicYear.findFirst({ where: { tenantId: tenant.id, isCurrent: true } });
  if (!year) {
    year = await db.academicYear.findFirst({ where: { tenantId: tenant.id } });
  }
  if (!year) {
    year = await db.academicYear.create({
      data: {
        tenantId: tenant.id,
        name: '2026/2027',
        code: '2026-2027',
        startsOn: on('2026-09-07'),
        endsOn: on('2027-07-23'),
        status: 'ACTIVE',
        isCurrent: true,
      },
    });
  }

  const TERMS = [
    ['T1', 'First Term', 1, '2026-09-07', '2026-12-18'],
    ['T2', 'Second Term', 2, '2027-01-11', '2027-04-02'],
  ] as const;

  const terms = new Map<string, { id: string; startsOn: Date; endsOn: Date }>();
  for (const [code, name, sequence, startsOn, endsOn] of TERMS) {
    const existing = await db.term.findFirst({
      where: { tenantId: tenant.id, academicYearId: year.id, code },
    });
    const term =
      existing ??
      (await db.term.create({
        data: {
          tenantId: tenant.id,
          academicYearId: year.id,
          code,
          name,
          sequence,
          startsOn: on(startsOn),
          endsOn: on(endsOn),
          status: sequence === 1 ? 'ACTIVE' : 'PLANNED',
          isCurrent: sequence === 1,
        },
      }));
    terms.set(code, { id: term.id, startsOn: term.startsOn, endsOn: term.endsOn });
  }

  // ---- classes ---------------------------------------------------------------------------
  const CLASSES = [
    ['B5A', 'Basic 5 A', 5, 'teacher.b5a@greenfield.example'],
    ['B5B', 'Basic 5 B', 5, 'teacher.b5b@greenfield.example'],
  ] as const;

  const classes = new Map<string, string>();
  for (const [code, name, yearLevel, teacherEmail] of CLASSES) {
    const existing = await db.classGroup.findFirst({
      where: { tenantId: tenant.id, academicYearId: year.id, code },
    });
    const group =
      existing ??
      (await db.classGroup.create({
        data: {
          tenantId: tenant.id,
          academicYearId: year.id,
          campusId: campus.id,
          code,
          name,
          yearLevel,
          classTeacherMembershipId: memberships.get(teacherEmail) ?? null,
        },
      }));
    classes.set(code, group.id);
  }
  console.log(`  ${CLASSES.length} classes, each with its own class teacher`);

  // ---- children, guardians, enrolment ------------------------------------------------------
  const termOne = terms.get('T1');
  if (!termOne) throw new Error('no first term');

  const students = new Map<string, string>();
  let seq = 0;
  for (const [firstName, lastName, dob, classCode, gender] of CHILDREN) {
    seq += 1;
    const reference = `STU-DEMO-${String(seq).padStart(3, '0')}`;
    const existing = await db.student.findFirst({
      where: { tenantId: tenant.id, reference },
    });
    const student =
      existing ??
      (await db.student.create({
        data: {
          tenantId: tenant.id,
          campusId: campus.id,
          reference,
          firstName,
          lastName,
          dateOfBirth: on(dob),
          gender,
          status: 'ENROLLED',
          // One child with something on file, so the alert flag on the register has a reason
          // to appear — and so it is visible that the teacher sees the FLAG and not the note.
          ...(firstName === 'Esi'
            ? { allergies: 'Peanuts', medicalNotes: 'Carries an inhaler; kept in the office.' }
            : {}),
        },
      }));
    students.set(`${firstName} ${lastName}`, student.id);

    const already = await db.enrolment.findFirst({
      where: { studentId: student.id, termId: termOne.id },
    });
    if (!already) {
      await db.enrolment.create({
        data: {
          tenantId: tenant.id,
          studentId: student.id,
          academicYearId: year.id,
          termId: termOne.id,
          campusId: campus.id,
          classId: classes.get(classCode) ?? null,
          enrolmentDate: termOne.startsOn,
          status: 'ACTIVE',
        },
      });
    }
  }
  console.log(`  ${CHILDREN.length} children, enrolled for the first term`);

  // One parent, two children — so "my children" is plural and the guardian reach rule has
  // something to get wrong.
  const parentMembership = memberships.get('parent@greenfield.example');
  let guardian = await db.guardian.findFirst({
    where: { tenantId: tenant.id, phoneE164: '+233200000001' },
  });
  if (!guardian) {
    guardian = await db.guardian.create({
      data: {
        tenantId: tenant.id,
        firstName: 'Akosua',
        lastName: 'Quaye',
        phoneE164: '+233200000001',
        email: 'parent@greenfield.example',
      },
    });
  }

  // The membership IS the guardian, which is what makes a parent's reach resolvable at all.
  if (parentMembership) {
    await db.membership.update({
      where: { id: parentMembership },
      data: { principalId: guardian.id },
    });
  }

  for (const name of ['Kojo Quaye', 'Yaa Nartey']) {
    const studentId = students.get(name);
    if (!studentId) continue;
    const link = await db.guardianRelationship.findFirst({
      where: { studentId, guardianId: guardian.id },
    });
    if (!link) {
      await db.guardianRelationship.create({
        data: {
          tenantId: tenant.id,
          studentId,
          guardianId: guardian.id,
          relationshipType: 'MOTHER',
          isPrimary: name === 'Kojo Quaye',
          paysFees: true,
        },
      });
    }
  }
  console.log('  1 guardian account, linked to 2 children');

  // ---- a register, already taken -------------------------------------------------------
  const b5a = classes.get('B5A');
  if (b5a) {
    const day = lastSchoolDay(termOne);
    const existing = await db.attendanceRegister.findFirst({
      where: { classGroupId: b5a, sessionDate: day },
    });

    if (!existing) {
      const register = await db.attendanceRegister.create({
        data: {
          tenantId: tenant.id,
          classGroupId: b5a,
          termId: termOne.id,
          sessionDate: day,
          takenByMembershipId: memberships.get('teacher.b5a@greenfield.example') ?? null,
        },
      });

      const roll = await db.enrolment.findMany({
        where: { classId: b5a, termId: termOne.id },
        select: { studentId: true },
      });

      for (const [index, row] of roll.entries()) {
        await db.attendanceEntry.create({
          data: {
            tenantId: tenant.id,
            registerId: register.id,
            studentId: row.studentId,
            status: index === 1 ? 'ABSENT' : index === 2 ? 'LATE' : 'PRESENT',
            ...(index === 2 ? { minutesLate: 12 } : {}),
            markedByMembershipId: memberships.get('teacher.b5a@greenfield.example') ?? null,
          },
        });
      }

      await db.attendanceRegister.update({
        where: { id: register.id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedByMembershipId: memberships.get('teacher.b5a@greenfield.example') ?? null,
        },
      });
      console.log(`  1 register for B5A on ${day.toISOString().slice(0, 10)}, submitted`);
    }
  }

  // ---- fees ----------------------------------------------------------------------------
  const FEES = [
    ['TUITION', 'Tuition', '1200.00'],
    ['PTA', 'PTA levy', '150.50'],
    ['BOOKS', 'Exercise books', '85.00'],
  ] as const;

  const feeItems = new Map<string, string>();
  for (const [code, name] of FEES) {
    const existing = await db.feeItem.findFirst({ where: { tenantId: tenant.id, code } });
    const item =
      existing ?? (await db.feeItem.create({ data: { tenantId: tenant.id, code, name } }));
    feeItems.set(code, item.id);
  }

  let schedule = await db.feeSchedule.findFirst({
    where: { tenantId: tenant.id, termId: termOne.id, classGroupId: null },
  });

  if (!schedule) {
    schedule = await db.feeSchedule.create({
      data: {
        tenantId: tenant.id,
        academicYearId: year.id,
        termId: termOne.id,
        name: 'First Term fees',
        currency: tenant.defaultCurrency,
        effectiveFrom: termOne.startsOn,
      },
    });

    for (const [code, , value] of FEES) {
      const feeItemId = feeItems.get(code);
      if (!feeItemId) continue;
      await db.feeScheduleLine.create({
        data: { tenantId: tenant.id, feeScheduleId: schedule.id, feeItemId, amount: value },
      });
    }

    await db.feeSchedule.update({
      where: { id: schedule.id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });
  }

  const lines = await db.feeScheduleLine.findMany({
    where: { feeScheduleId: schedule.id },
    select: { amount: true, feeItemId: true, feeItem: { select: { name: true } } },
  });

  // Through the money library, not Number(). Rule 8 has no seed-file exception: a total
  // computed with floating point here is a total somebody copies into production code.
  const total = lines.length === 0 ? ZERO : add(...lines.map((l) => amount(String(l.amount))));

  let raised = 0;
  for (const [name, studentId] of students) {
    const existing = await db.invoice.findFirst({
      where: { studentId, termId: termOne.id, status: { in: ['DRAFT', 'ISSUED'] } },
    });
    if (existing) continue;

    raised += 1;
    const isDraft = name === 'Abena Danso';

    // One transaction for the header and its lines. `invoice_totals_match_lines` is a
    // DEFERRED constraint trigger — it checks at commit precisely so a multi-statement build
    // is judged on its result — and writing the header in a transaction of its own means it
    // commits alone, with a total and no lines, which is exactly the state it refuses.
    const invoice = await db.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          tenantId: tenant.id,
          studentId,
          academicYearId: year.id,
          termId: termOne.id,
          currency: tenant.defaultCurrency,
          issuedOn: null,
          dueOn: on('2026-10-05'),
          subtotal: total,
          total,
          invoiceNo: null,
          status: 'DRAFT',
        },
      });

      for (const line of lines) {
        await tx.invoiceLine.create({
          data: {
            tenantId: tenant.id,
            invoiceId: created.id,
            feeItemId: line.feeItemId,
            description: line.feeItem.name,
            quantity: 1,
            unitAmount: amount(String(line.amount)),
            lineTotal: amount(String(line.amount)),
          },
        });
      }

      // Issued only once its lines exist. `invoice_line_requires_draft` refuses a line on an
      // issued invoice — the family holds a piece of paper, and a row that changes behind it
      // makes the two disagree with no record of which was right.
      if (!isDraft) {
        await tx.invoice.update({
          where: { id: created.id },
          data: {
            status: 'ISSUED',
            issuedOn: termOne.startsOn,
            invoiceNo: `INV-DEMO-${String(raised).padStart(4, '0')}`,
          },
        });
      }

      return created;
    });

    // One family has paid part of it, so the screens have an outstanding balance that is
    // neither nothing nor everything — which is the case every rounding bug hides in.
    const bursar = memberships.get('bursar@greenfield.example');
    if (name === 'Kojo Quaye' && bursar) {
      const payment = await db.payment.create({
        data: {
          tenantId: tenant.id,
          studentId,
          amount: '500.00',
          currency: tenant.defaultCurrency,
          method: 'MOBILE_MONEY',
          reference: 'MOMO-DEMO-0001',
          receiptNo: 'RCPT-DEMO-0001',
          receivedOn: on('2026-09-20'),
          receivedByMembershipId: bursar,
        },
      });
      await db.paymentAllocation.create({
        data: {
          tenantId: tenant.id,
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: '500.00',
        },
      });
    }
  }
  if (raised > 0) {
    console.log(`  ${raised} invoices raised against a ${formatMoney(total, tenant.defaultCurrency)} price list`);
  }

  console.log(`
  Sign in at /sign-in. Every account below uses the same password.

    password   ${DEMO_PASSWORD}
`);
  for (const [email, name, role] of CAST) {
    console.log(`    ${email.padEnd(34)} ${role.padEnd(16)} ${name}`);
  }
  console.log(`
  Worth trying, in this order:

    bursar      → Fees. Raise, issue, take a payment. The partial one is Kojo Quaye.
    teacher.b5a → Attendance, and NO Fees link at all. §4: a class teacher must not
                  know which family has not paid. Also: only B5A, never B5B.
    teacher.b5b → the same screens, a different class. Same permissions, different reach.
    parent      → two children and their fee ledger, and nobody else's.
    finance     → the only one who can approve a refund the bursar requested. Try
                  approving your own — the database refuses it.
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
