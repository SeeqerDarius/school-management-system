# 0009. Identifier strategy: UUIDv7 keys, separate human reference codes

*What this is for: deciding what a primary key looks like, and what a human reads off a receipt. Read it before adding a table, an id column, or anything that prints a number a parent will quote back to you on the phone.*

## Status

Accepted — 2026-09-18

**Implementation status: partly built.** `Ids.newId()` (UUIDv7 via `uuid-creator` 6.1.1),
`platform.reference_sequence` and `platform.next_reference(uuid, text, text)` all exist
(`V0001__platform_core.sql`). `ReferenceNumberService`, the Java wrapper referenced from
`Ids`' javadoc, is **planned**.

## Context

Two different jobs get confused into one column in most school systems.

A **primary key** is the database's business: joins, foreign keys, replication, caching. It
must be unique, stable, cheap to index, and it will appear in URLs and API payloads whether
we like it or not.

A **reference code** is a human's business: `STU-2026-000123` on an admission letter,
`REC-2026-000932` on a receipt a parent photographs and sends to a bursar over WhatsApp. It
must be readable over a bad phone line, meaningful to someone with no database access, and —
for anything financial — auditable in sequence.

Making one column do both jobs is where the trouble starts. If the primary key is
`bigserial` and also printed on the receipt, then the receipt number tells you how many
receipts exist, and the URL `/students/4471` tells you that `/students/4470` exists too.

We are multi-tenant. School A holding an identifier from its own data must learn nothing
about School B. Row-Level Security (Invariant I-1) stops School A *reading* School B's row,
but a sequential key still leaks volume, growth rate and creation order across the whole
platform, and it makes a missing RLS policy catastrophic rather than merely bad: the attacker
does not have to guess an id, they can count.

## Decision

**Every primary key is a UUIDv7, generated in the application. Every human-facing reference
code is a separate column, allocated by `platform.next_reference()`.**

### Primary keys: UUIDv7, application-generated

```java
// services/core-api/src/main/java/io/sankofa/school/platform/id/Ids.java
public static UUID newId() {
    return UuidCreator.getTimeOrderedEpoch();
}
```

A UUIDv7 lays out as: 48 bits of Unix milliseconds, 4 version bits, 12 bits of sub-millisecond
or counter data, 2 variant bits, 62 bits of randomness. The important property is that the
timestamp is in the **high-order** bits, so the natural byte ordering is time ordering.

Generated application-side, not by a database default, because:

- An aggregate and its children can be built in memory with their relationships already wired
  before anything is written.
- An outbox row can carry the id of the thing it describes, in the same transaction, without
  a round trip to read back a generated key.
- An idempotency key can be computed client-side and matched server-side.

### Reference codes: separate column, separate allocator

`STU-2026-000123` is stored in `student_no text`, never as the key. Allocation is
`platform.next_reference(tenant_id, scope, period_key)`, which does a single
`UPDATE ... RETURNING` against `platform.reference_sequence` — a row lock, so two cashiers
issuing receipts at the same second cannot mint the same number.

| Scope | Prefix | Period key | Example |
|---|---|---|---|
| `STUDENT` | `STU` | academic year | `STU-2026-000123` |
| `INVOICE` | `INV` | academic year | `INV-2026-000045` |
| `RECEIPT` | `REC` | academic year | `REC-2026-000932` |
| `STAFF` | `STAFF` | none | `STAFF-0012` |

Reference codes are unique **per tenant per scope per period**, never globally. They are
never a foreign key target and never appear in a join condition. If you find yourself joining
on `student_no`, the model is wrong.

### Receipt numbers are never reused and never reordered

This is the constraint that decides the design of the allocator rather than the other way
round. A receipt sequence is evidence. An auditor reading `REC-2026-000930`,
`REC-2026-000931`, `REC-2026-000932` is entitled to conclude those payments were recorded in
that order, and that no fourth receipt was quietly slipped between them and removed.

Therefore:

- `next_value` in `platform.reference_sequence` only ever increases. There is no reset, no
  "renumber", no administrative edit. `ck_refseq_next CHECK (next_value >= 1)` is the floor.
- A financial document is never deleted (AGENTS.md §5, Invariant I-3). A receipt issued in
  error is **voided or reversed**, and keeps its number. The number stays occupied forever.
- The period key changes the sequence, not the ordering within it. `REC-2027-000001` follows
  `REC-2026-001440` in time and everyone understands why.

### Gaps: tolerated, bounded, explainable

`platform.next_reference()` increments inside the caller's transaction. That matters, and it
is the reason we did **not** use a PostgreSQL `SEQUENCE`:

- A `SEQUENCE` is deliberately non-transactional. `nextval()` survives a rollback, so every
  failed payment attempt burns a receipt number permanently. For a high-volume surrogate key
  that is a feature. For a receipt book it means unexplainable holes.
- The row-lock allocator rolls back with its transaction, so the common failure — validation
  fails, payment gateway declines, user cancels — returns the number to the pool and leaves
  no gap at all.

Gaps are still possible, and we accept them:

- A crash between a committed allocation and a later, separate transaction that was meant to
  use it.
- An operator-level intervention recorded as such.

When a gap exists, it must be explainable. That is what the audit trail is for: the
allocation, the document it was allocated for, and the outcome are all recorded, so "why is
there no `REC-2026-000871`?" has an answer rather than a shrug. A gap that nobody can explain
is an incident, not a quirk.

The cost of transactional allocation is a held row lock: every concurrent allocation of the
same `(tenant, scope, period)` serialises behind the first until it commits. **Allocate as
late as possible in the transaction**, after validation and after any external call, so the
lock is held for microseconds rather than for the duration of a payment gateway round trip.

## Consequences

### Positive

- Keys are unguessable. An identifier tells an attacker nothing about neighbouring rows, in
  this tenant or any other, so RLS is a second line of defence rather than the only one.
- Index locality is preserved. Inserts land at the right-hand edge of the B-tree, keeping the
  hot pages in shared buffers and avoiding the page-split churn that random keys cause.
- `ORDER BY id` is approximately `ORDER BY created_at`, which is genuinely useful for paging
  and for reading a table during an incident.
- Ids are mergeable. Data imported from another system, generated offline, or created in a
  test fixture never collides.
- Humans get a code designed for humans: fixed width, prefixed, year-scoped, unambiguous over
  the phone.

### Negative

- 16 bytes per key against 8 for a `bigint`, duplicated into every foreign key and every
  index that includes one. On a large `attendance` table this is real, measurable storage.
- `STU-2026-000123` looks like a key to everyone who sees it, and someone will eventually try
  to join on it or use it as a URL parameter. Review for this.
- Two ways to refer to one student means support conversations, logs and exports have to be
  clear about which one they are quoting.
- UUIDv7 embeds a millisecond timestamp in a value we hand to clients. Anyone holding an id
  learns when that row was created, to the millisecond.
- The allocator serialises per `(tenant, scope, period)`. A bulk invoice run for 2,000
  students is 2,000 sequential allocations under one lock, not a parallel free-for-all.

### Risks accepted

- **Creation-time disclosure via UUIDv7.** Accepted. The alternative is UUIDv4, which costs
  index locality and write amplification for every row in the system in exchange for hiding a
  timestamp that is usually visible in `created_at` anyway. Do not use a UUIDv7 as a secret;
  secrets are separate, random, and not primary keys.
- **Reference-code contention under bulk operations.** Accepted and bounded by allocating
  late. If a bulk run becomes a problem, allocate a block under one lock rather than removing
  the lock.
- **Storage overhead.** Accepted. Measured, not assumed; revisit only with numbers from a
  real table.
- **Gap-free is not guaranteed.** Accepted, because the audit trail makes every gap
  explainable. Guaranteeing gap-freedom would require holding the lock across the whole
  business operation, which trades a rare explainable hole for a routine availability problem.

## Alternatives considered

**`bigserial` primary keys.** The default, and the wrong default here. Sequential integers
are enumerable, so a broken authorization check becomes a full data extraction rather than a
single leaked row. Across tenants they leak volume and growth — a competitor counting invoice
ids learns our business. They also force every tenant's inserts through one shared sequence,
which is a contention point we get for free with UUIDs.

**`bigserial` internally with a public random id alongside.** A real pattern, used well by
several payment platforms. Rejected because it means two identifiers per row with a mapping
that must never be confused, and the day someone puts the internal id in an API response is
the day the enumeration risk returns silently. UUIDv7 gets most of the index benefit without
the second column.

**UUIDv4.** Unguessable and simple, and it was the obvious choice for years. Rejected on
write behaviour: random keys scatter inserts across the entire index, so the working set is
the whole index rather than its right-hand edge, page splits are frequent, and each split
that touches a page not yet written since the last checkpoint triggers a full-page write into
the WAL. On a write-heavy table — attendance, ledger lines — that amplification is the
difference between a cheap insert and an expensive one. UUIDv7 keeps the unguessability and
loses the scatter.

**ULID.** Same time-ordered idea, and a nicer 26-character Crockford base-32 text form.
Rejected because PostgreSQL has a native 16-byte `uuid` type with native indexing and
`java.util.UUID` is in the JDK, while ULID would mean either a `text` column (bigger, slower)
or a custom type plus a conversion layer at every boundary. UUIDv7 is the standardised
(RFC 9562) version of the same idea, with first-class support on both sides.

**Composite natural keys** (`tenant_id, student_no`). Rejected. Natural keys change — a
student number gets corrected, a school renumbers after a merger — and a changing key
cascades through every referencing table. Surrogate keys exist precisely so that human-facing
identifiers can be corrected without rewriting the graph.

**One global sequence for reference codes across tenants.** Rejected. School A's receipt
numbers would jump unpredictably because School B is busy, which is both confusing and a
cross-tenant information leak.
