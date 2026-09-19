/**
 * Seeds the permission catalogue, the system role templates, and — outside production — one
 * demo school you can sign into.
 *
 *   npm run db:seed
 *
 * Idempotent: safe to run repeatedly. Permissions and roles are upserted by their stable
 * codes, so re-running updates descriptions and grants without duplicating anything.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

import { PERMISSIONS, ROLES } from './seed-data';

const db = new PrismaClient();

async function main() {
  console.log('Seeding RBAC catalogue…');

  // ---- permissions -------------------------------------------------------------------
  for (const permission of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: permission.code },
      create: permission,
      update: {
        module: permission.module,
        description: permission.description,
        isSensitive: permission.isSensitive,
        isChildSensitive: permission.isChildSensitive,
      },
    });
  }
  console.log(`  ${PERMISSIONS.length} permissions`);

  // ---- system roles ------------------------------------------------------------------
  let grantCount = 0;
  for (const role of ROLES) {
    // Not an upsert. A system role has no tenant, and `tenantId = NULL` matches nothing in
    // SQL, so an upsert on the compound key would create a fresh duplicate on every run.
    // The partial unique index added in 20260919091000 now refuses that outright.
    const existing = await db.role.findFirst({
      where: { tenantId: null, code: role.code },
      select: { id: true },
    });

    const record = existing
      ? await db.role.update({
          where: { id: existing.id },
          data: { name: role.name, description: role.description, scope: role.scope },
        })
      : await db.role.create({
          data: {
            code: role.code,
            name: role.name,
            description: role.description,
            scope: role.scope,
            isSystem: true,
            isAssignable: true,
          },
        });

    const permissionIds = await db.permission.findMany({
      where: { code: { in: role.permissions } },
      select: { id: true },
    });

    // A role granting a permission that is not in the catalogue is a typo in the role
    // definition, and it fails silently: the role simply comes out weaker than intended, and
    // nobody notices until someone cannot do their job.
    if (permissionIds.length !== role.permissions.length) {
      const found = new Set(
        (
          await db.permission.findMany({
            where: { code: { in: role.permissions } },
            select: { code: true },
          })
        ).map((permission) => permission.code),
      );
      const missing = role.permissions.filter((code) => !found.has(code));
      throw new Error(
        `Role ${role.code} grants unknown permissions: ${missing.join(', ')}`,
      );
    }

    // Replace rather than merge: a permission removed from a role's definition must actually
    // be revoked, or tightening a role would silently do nothing.
    await db.rolePermission.deleteMany({ where: { roleId: record.id } });
    await db.rolePermission.createMany({
      data: permissionIds.map((p) => ({ roleId: record.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    grantCount += permissionIds.length;
  }
  console.log(`  ${ROLES.length} system roles, ${grantCount} grants`);

  // ---- demo school -------------------------------------------------------------------
  // Never in production. A seeded account with a known-shaped password is a development
  // convenience and a production back door, and the difference is only this check.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    console.log('\nProduction detected — skipping demo data.');
    return;
  }

  await seedDemoSchool();
}

async function seedDemoSchool() {
  console.log('\nSeeding demo school…');

  const tenant = await db.tenant.upsert({
    where: { slug: 'greenfield' },
    create: {
      slug: 'greenfield',
      legalName: 'Greenfield International School',
      displayName: 'Greenfield International School',
      shortName: 'Greenfield',
      status: 'ACTIVE',
      countryCode: 'GH',
      defaultCurrency: 'GHS',
      timezone: 'Africa/Accra',
      locale: 'en-GH',
      onboardingState: 'IN_PROGRESS',
    },
    update: {},
  });

  await db.campus.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MAIN' } },
    create: {
      tenantId: tenant.id,
      code: 'MAIN',
      name: 'Main Campus',
      isMain: true,
      status: 'ACTIVE',
      city: 'Accra',
      region: 'Greater Accra',
      countryCode: 'GH',
    },
    update: {},
  });

  await db.branding.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      motto: 'Knowledge and Character',
      primaryColor: '#1F5B8F',
      accentColor: '#17734A',
    },
    update: {},
  });

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@greenfield.example';

  // A generated password printed once, rather than a constant committed to the repository.
  // A well-known seed password is the kind of thing that survives into a real deployment.
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  const generated = !process.env.SEED_ADMIN_PASSWORD;

  const user = await db.appUser.upsert({
    where: { email },
    create: {
      email,
      fullName: 'Ama Mensah',
      status: 'ACTIVE',
      emailVerified: true,
      passwordHash: await bcrypt.hash(password, 12),
    },
    update: { passwordHash: await bcrypt.hash(password, 12), status: 'ACTIVE' },
  });

  const membership = await db.membership.upsert({
    where: {
      tenantId_userId_principalType: {
        tenantId: tenant.id,
        userId: user.id,
        principalType: 'STAFF',
      },
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      status: 'ACTIVE',
      principalType: 'STAFF',
      startedOn: new Date(),
      acceptedAt: new Date(),
    },
    update: { status: 'ACTIVE' },
  });

  const adminRole = await db.role.findFirst({
    where: { code: 'SCHOOL_ADMIN', tenantId: null },
  });
  if (adminRole) {
    await db.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: adminRole.id } },
      create: { membershipId: membership.id, roleId: adminRole.id },
      update: {},
    });
  }

  console.log(`  School  Greenfield International School (greenfield)`);
  console.log(`  Campus  MAIN — Main Campus, Accra`);
  console.log(`  Sign in as`);
  console.log(`    email     ${email}`);
  console.log(`    password  ${password}${generated ? '   (generated — save it now)' : ''}`);
  console.log(`    role      SCHOOL_ADMIN`);
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
