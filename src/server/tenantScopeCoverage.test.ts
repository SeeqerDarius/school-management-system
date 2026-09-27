import { describe, expect, it } from 'vitest';

import { modelsWithTenantId, scopedModels } from '@/server/tenant-scope';

/**
 * The scoping list must cover every tenant-owned model.
 *
 * <p>This is the failure mode the tenant-scope extension cannot defend against by itself: a new
 * table is added with a `tenantId`, nobody adds it to the list, and every query against it runs
 * unscoped. Nothing throws. Nothing looks wrong. The rows of every school are simply returned to
 * whoever asks.
 *
 * <p>So the check is inverted here. Rather than trusting the list, the list is compared against
 * the generated data model, which cannot be forgotten because Prisma writes it.
 */
describe('tenant scope coverage', () => {
  const listed = new Set([
    ...scopedModels.owned,
    ...scopedModels.keyed,
    ...scopedModels.optional,
    ...scopedModels.shared,
  ]);

  it('lists every model that carries a tenantId', () => {
    const missing = modelsWithTenantId().filter((model) => !listed.has(model));

    expect(
      missing,
      `These models have a tenantId but are not scoped by src/server/tenant-scope.ts: ` +
        `${missing.join(', ')}. Add them to TENANT_OWNED, TENANT_KEYED, TENANT_OPTIONAL or ` +
        `TENANT_SHARED — ` +
        'an unlisted model is queried across every school at once.',
    ).toEqual([]);
  });

  it('lists nothing that has no tenantId', () => {
    const declared = new Set(modelsWithTenantId());
    const phantom = [...listed].filter((model) => !declared.has(model));

    // A stale name here is not dangerous, but it is misleading: it reads as though something
    // is protected when the model it names no longer exists.
    expect(phantom, `Scoped models that no longer declare a tenantId: ${phantom.join(', ')}`)
      .toEqual([]);
  });

  it('puts every model in exactly one category', () => {
    const all = [
      ...scopedModels.owned,
      ...scopedModels.keyed,
      ...scopedModels.optional,
      ...scopedModels.shared,
    ];
    expect(all.length).toBe(new Set(all).size);
  });
});
