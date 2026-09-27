-- CreateEnum
CREATE TYPE "FeeScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "studentsSeeFeeBalance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "fee_item" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "classGroupId" UUID,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "FeeScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedule_line" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feeScheduleId" UUID NOT NULL,
    "feeItemId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_schedule_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceNo" TEXT,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "feeScheduleId" UUID,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "issuedOn" DATE,
    "dueOn" DATE,
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "feeItemId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(19,4) NOT NULL,
    "discount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "creditNoteNo" TEXT,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "issuedByMembershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "receiptNo" TEXT,
    "studentId" UUID NOT NULL,
    "payerGuardianId" UUID,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "receivedOn" DATE NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "reversedAt" TIMESTAMP(3),
    "reversedReason" TEXT,
    "receivedByMembershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByMembershipId" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMembershipId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_item_tenantId_isActive_idx" ON "fee_item"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "fee_item_tenantId_code_key" ON "fee_item"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_item_id_tenantId_key" ON "fee_item"("id", "tenantId");

-- CreateIndex
CREATE INDEX "fee_schedule_tenantId_termId_status_idx" ON "fee_schedule"("tenantId", "termId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedule_id_tenantId_key" ON "fee_schedule"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedule_line_feeScheduleId_feeItemId_key" ON "fee_schedule_line"("feeScheduleId", "feeItemId");

-- CreateIndex
CREATE INDEX "invoice_tenantId_studentId_termId_idx" ON "invoice"("tenantId", "studentId", "termId");

-- CreateIndex
CREATE INDEX "invoice_tenantId_status_idx" ON "invoice"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_invoiceNo_key" ON "invoice"("tenantId", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_id_tenantId_key" ON "invoice"("id", "tenantId");

-- CreateIndex
CREATE INDEX "invoice_line_tenantId_invoiceId_idx" ON "invoice_line"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "credit_note_tenantId_invoiceId_idx" ON "credit_note"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_tenantId_creditNoteNo_key" ON "credit_note"("tenantId", "creditNoteNo");

-- CreateIndex
CREATE INDEX "payment_tenantId_studentId_idx" ON "payment"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "payment_tenantId_receivedOn_idx" ON "payment"("tenantId", "receivedOn");

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenantId_receiptNo_key" ON "payment"("tenantId", "receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "payment_id_tenantId_key" ON "payment"("id", "tenantId");

-- CreateIndex
CREATE INDEX "payment_allocation_tenantId_invoiceId_idx" ON "payment_allocation"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocation_paymentId_invoiceId_key" ON "payment_allocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE INDEX "refund_tenantId_status_idx" ON "refund"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "fee_item" ADD CONSTRAINT "fee_item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_academicYearId_tenantId_fkey" FOREIGN KEY ("academicYearId", "tenantId") REFERENCES "academic_year"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_termId_tenantId_fkey" FOREIGN KEY ("termId", "tenantId") REFERENCES "term"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_classGroupId_tenantId_fkey" FOREIGN KEY ("classGroupId", "tenantId") REFERENCES "class_group"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule_line" ADD CONSTRAINT "fee_schedule_line_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule_line" ADD CONSTRAINT "fee_schedule_line_feeScheduleId_tenantId_fkey" FOREIGN KEY ("feeScheduleId", "tenantId") REFERENCES "fee_schedule"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule_line" ADD CONSTRAINT "fee_schedule_line_feeItemId_tenantId_fkey" FOREIGN KEY ("feeItemId", "tenantId") REFERENCES "fee_item"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_studentId_tenantId_fkey" FOREIGN KEY ("studentId", "tenantId") REFERENCES "student"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_academicYearId_tenantId_fkey" FOREIGN KEY ("academicYearId", "tenantId") REFERENCES "academic_year"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_termId_tenantId_fkey" FOREIGN KEY ("termId", "tenantId") REFERENCES "term"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_feeScheduleId_tenantId_fkey" FOREIGN KEY ("feeScheduleId", "tenantId") REFERENCES "fee_schedule"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "invoice"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_feeItemId_tenantId_fkey" FOREIGN KEY ("feeItemId", "tenantId") REFERENCES "fee_item"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "invoice"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_studentId_tenantId_fkey" FOREIGN KEY ("studentId", "tenantId") REFERENCES "student"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_payerGuardianId_tenantId_fkey" FOREIGN KEY ("payerGuardianId", "tenantId") REFERENCES "guardian"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_paymentId_tenantId_fkey" FOREIGN KEY ("paymentId", "tenantId") REFERENCES "payment"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "invoice"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_tenantId_fkey" FOREIGN KEY ("paymentId", "tenantId") REFERENCES "payment"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Money.
--
-- Everything below is what Prisma cannot express. There is more of it here than in any
-- previous migration, and the reason is not thoroughness for its own sake: this is the first
-- module where a bug is a family being told they owe money they have already paid, or a
-- school's books not adding up at the end of a term. An accountant will reconcile these
-- tables by hand one day, and every rule here is one they would otherwise have to find.
--
-- Three invariants drive it:
--   I-2  every amount is numeric(19,4) with an explicit currency, and the currencies of two
--        rows that touch each other must agree.
--   I-3  an ISSUED invoice and a RECORDED payment are immutable. Correct by credit note or
--        by reversal — never by an edit.
--   I-4  the pattern, not the journal rule itself: totals that span rows are checked by a
--        DEFERRED constraint trigger at commit, so a multi-statement build is judged on its
--        result rather than on its intermediate states.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Row-level security.
-- -------------------------------------------------------------------------------------
ALTER TABLE "fee_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_schedule_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "fee_item", "fee_schedule", "fee_schedule_line", "invoice", "invoice_line",
  "credit_note", "payment", "payment_allocation", "refund"
  TO sankofa_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fee_item', 'fee_schedule', 'fee_schedule_line', 'invoice', 'invoice_line',
    'credit_note', 'payment', 'payment_allocation', 'refund'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I AS PERMISSIVE FOR ALL TO sankofa_app '
      'USING ("tenantId" = app.current_tenant_id()) '
      'WITH CHECK ("tenantId" = app.current_tenant_id())', t);
  END LOOP;
END
$$;

-- -------------------------------------------------------------------------------------
-- 2. What an amount is allowed to be.
-- -------------------------------------------------------------------------------------

-- ISO-4217: three uppercase letters. A lowercase or padded code is the kind of thing that
-- makes two otherwise-equal amounts fail to match during reconciliation.
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_currency_is_iso"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_currency_is_iso"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_currency_is_iso"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payment" ADD CONSTRAINT "payment_currency_is_iso"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "refund" ADD CONSTRAINT "refund_currency_is_iso"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Nothing here is ever negative. A reduction is a credit note; money going back out is a
-- refund. Allowing a negative amount would make both of those expressible as a sign flip on
-- an existing row, which is precisely the edit I-3 exists to prevent.
ALTER TABLE "fee_schedule_line" ADD CONSTRAINT "fee_schedule_line_amount_not_negative"
  CHECK ("amount" >= 0);
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_amounts_not_negative"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "total" >= 0);
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_amounts_sane"
  CHECK ("quantity" > 0 AND "unitAmount" >= 0 AND "discount" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_amount_positive"
  CHECK ("amount" > 0);
ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_positive"
  CHECK ("amount" > 0);
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_amount_positive"
  CHECK ("amount" > 0);
ALTER TABLE "refund" ADD CONSTRAINT "refund_amount_positive"
  CHECK ("amount" > 0);

-- The line's own arithmetic, checked on the row that states it. A stored total that does not
-- match its own inputs is the single easiest way for an invoice to be wrong in a way nobody
-- notices, because every screen reads the stored value.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_total_is_its_parts"
  CHECK ("lineTotal" = ("quantity" * "unitAmount") - "discount");

ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_discount_within_line"
  CHECK ("discount" <= ("quantity" * "unitAmount"));

ALTER TABLE "invoice" ADD CONSTRAINT "invoice_total_is_subtotal_less_discount"
  CHECK ("total" = "subtotal" - "discountTotal");

ALTER TABLE "invoice" ADD CONSTRAINT "invoice_discount_within_subtotal"
  CHECK ("discountTotal" <= "subtotal");

-- -------------------------------------------------------------------------------------
-- 3. Documents say the same thing as their own status.
--
-- Each of these is a CASE over a NOT NULL column, so every branch yields a real boolean. A
-- CHECK that evaluates to NULL passes — the bug that got a reasonless revocation into
-- `guardian_relationship` in 20260920010000_student_guardian_enrolment.
-- -------------------------------------------------------------------------------------

-- An issued invoice has a number and a date; a draft has neither, because a draft that never
-- issues must not consume a number out of a sequence an auditor reads as contiguous.
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_status_coherent"
  CHECK (
    CASE "status"
      WHEN 'DRAFT' THEN
        "invoiceNo" IS NULL AND "issuedOn" IS NULL AND "cancelledAt" IS NULL
      WHEN 'ISSUED' THEN
        "invoiceNo" IS NOT NULL AND "issuedOn" IS NOT NULL AND "cancelledAt" IS NULL
      WHEN 'CANCELLED' THEN
        "cancelledAt" IS NOT NULL
        AND "cancelledReason" IS NOT NULL
        AND length(btrim("cancelledReason")) >= 8
    END
  );

ALTER TABLE "invoice" ADD CONSTRAINT "invoice_due_after_issue"
  CHECK ("dueOn" IS NULL OR "issuedOn" IS NULL OR "dueOn" >= "issuedOn");

ALTER TABLE "payment" ADD CONSTRAINT "payment_status_coherent"
  CHECK (
    CASE "status"
      WHEN 'RECORDED' THEN "reversedAt" IS NULL AND "reversedReason" IS NULL
      WHEN 'REVERSED' THEN
        "reversedAt" IS NOT NULL
        AND "reversedReason" IS NOT NULL
        AND length(btrim("reversedReason")) >= 8
    END
  );

-- A mobile-money or bank payment with no reference cannot be reconciled against the
-- statement, and an unreconcilable receipt is how cash goes missing without anybody lying.
-- Cash and cheque are exempt: the cheque number goes here when there is one, and a cash
-- receipt's evidence is the receipt.
ALTER TABLE "payment" ADD CONSTRAINT "payment_electronic_has_a_reference"
  CHECK (
    "method" NOT IN ('MOBILE_MONEY', 'BANK_TRANSFER')
    OR ("reference" IS NOT NULL AND length(btrim("reference")) >= 3)
  );

-- §188. A credit note reduces what a family owes; somebody has to be able to say why.
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_reason_meaningful"
  CHECK (length(btrim("reason")) >= 8);

ALTER TABLE "refund" ADD CONSTRAINT "refund_reason_meaningful"
  CHECK (length(btrim("reason")) >= 8);

ALTER TABLE "refund" ADD CONSTRAINT "refund_decision_coherent"
  CHECK (
    CASE "status"
      WHEN 'REQUESTED' THEN "decidedByMembershipId" IS NULL AND "decidedAt" IS NULL
      ELSE "decidedByMembershipId" IS NOT NULL AND "decidedAt" IS NOT NULL
    END
  );

-- ------------------------------------------------------------------------------------
-- Maker-checker, as a constraint rather than as a hidden button.
--
-- Spec 134, and what the BURSAR role's own description promises: "refund approval and
-- journal posting sit with a different holder". The bursar holds PAYMENT_REFUND; the finance
-- manager holds PAYMENT_REFUND_APPROVE. One person who can do both can pay themselves.
--
-- Stated here because a permission check lives in one action, and this has to hold against a
-- script, a support query and a future second code path that nobody has written yet.
-- ------------------------------------------------------------------------------------
ALTER TABLE "refund" ADD CONSTRAINT "refund_is_not_self_approved"
  CHECK ("decidedByMembershipId" IS NULL
      OR "decidedByMembershipId" <> "requestedByMembershipId");

-- A schedule that is active says when it became active.
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_status_coherent"
  CHECK (
    CASE "status"
      WHEN 'DRAFT' THEN "activatedAt" IS NULL AND "archivedAt" IS NULL
      WHEN 'ACTIVE' THEN "activatedAt" IS NOT NULL AND "archivedAt" IS NULL
      WHEN 'ARCHIVED' THEN "archivedAt" IS NOT NULL
    END
  );

-- One live price list per class per term. Two would mean the answer to "what does this child
-- pay" depends on which row the query happened to read first.
CREATE UNIQUE INDEX "fee_schedule_one_active_per_class"
  ON "fee_schedule" ("termId", "classGroupId")
  WHERE "status" = 'ACTIVE' AND "classGroupId" IS NOT NULL;

-- And one live general schedule per term, for classes with no schedule of their own. A
-- partial index cannot treat NULL as a value, so this is a separate index over the rows
-- where classGroupId IS NULL rather than a column in the one above.
CREATE UNIQUE INDEX "fee_schedule_one_active_general"
  ON "fee_schedule" ("termId")
  WHERE "status" = 'ACTIVE' AND "classGroupId" IS NULL;

-- One live invoice per child per term. A second is how a family is billed twice, and the
-- cancelled ones are excluded so a corrected re-issue is still possible.
CREATE UNIQUE INDEX "invoice_one_live_per_student_term"
  ON "invoice" ("studentId", "termId")
  WHERE "status" <> 'CANCELLED';

-- -------------------------------------------------------------------------------------
-- 4. The rules that span rows.
--
-- SECURITY DEFINER throughout, for the reason established in
-- 20260927000000_attendance_register: a guard that reads rows *through* the
-- caller's row-level security can be defeated by the policies hiding the rows it is checking
-- for. An over-allocation check that sees no allocations concludes there is room for more.
-- -------------------------------------------------------------------------------------

-- 4a. An issued invoice is immutable (I-3).
--
-- The whole point of a document. The family is holding a piece of paper; if the row behind it
-- can change, the two disagree and there is no record of which was right. A reduction is a
-- credit note. An increase is a second invoice.
--
-- Cancellation is allowed from ISSUED, but only while nothing has been paid against it:
-- cancelling an invoice that has money allocated to it orphans the money.
CREATE OR REPLACE FUNCTION app.invoice_is_immutable_once_issued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settled numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'an invoice that has been issued cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'a cancelled invoice cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'ISSUED' THEN
    IF NEW."status" = 'CANCELLED' THEN
      SELECT coalesce(sum(a."amount"), 0) INTO v_settled
        FROM public.payment_allocation a WHERE a."invoiceId" = OLD.id;

      IF v_settled > 0 THEN
        RAISE EXCEPTION
          'this invoice has % allocated against it and cannot be cancelled; raise a credit note instead',
          v_settled
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."status" = 'ISSUED' THEN
      -- Still issued, so the money must not have moved. Notes and the due date may change;
      -- nothing an accountant reconciles may.
      IF NEW."subtotal" <> OLD."subtotal"
         OR NEW."discountTotal" <> OLD."discountTotal"
         OR NEW."total" <> OLD."total"
         OR NEW."currency" <> OLD."currency"
         OR NEW."invoiceNo" IS DISTINCT FROM OLD."invoiceNo"
         OR NEW."issuedOn" IS DISTINCT FROM OLD."issuedOn"
         OR NEW."studentId" <> OLD."studentId"
      THEN
        RAISE EXCEPTION
          'an issued invoice cannot be changed; raise a credit note to reduce it'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'an issued invoice cannot go back to draft' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER invoice_is_immutable_once_issued
  BEFORE UPDATE OR DELETE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION app.invoice_is_immutable_once_issued();

-- 4b. And its lines with it. Without this, "an issued invoice cannot be changed" would mean
--     only its own columns, and the lines — which are what the invoice actually says — would
--     stay editable.
CREATE OR REPLACE FUNCTION app.invoice_line_requires_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END;
  v_status  text;
BEGIN
  SELECT i."status"::text INTO v_status FROM public.invoice i WHERE i.id = v_invoice;

  -- Null when the invoice is being deleted in the same statement; the cascade is legitimate.
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'the lines of an issued invoice cannot be changed' USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER invoice_line_requires_draft
  BEFORE INSERT OR UPDATE OR DELETE ON "invoice_line"
  FOR EACH ROW EXECUTE FUNCTION app.invoice_line_requires_draft();

-- 4c. The invoice adds up — the I-4 pattern applied to a document rather than a journal.
--
-- DEFERRED, and that is the load-bearing word. An invoice is built by several statements: the
-- header, then the lines, then the totals. Checking eagerly would fail on the first one. At
-- commit, the result is judged, and a multi-statement build is judged on what it produced.
CREATE OR REPLACE FUNCTION app.invoice_totals_match_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice   uuid;
  v_subtotal  numeric;
  v_discount  numeric;
  v_stated    record;
BEGIN
  -- Which invoice to check, and the branching is not stylistic. One trigger function serves
  -- two tables, and plpgsql PREPARES every expression it reaches — so a single expression
  -- naming both `NEW.id` and `OLD."invoiceId"` fails on the `invoice` table, which has no
  -- `invoiceId` column, before any branch is chosen. Each statement below names only columns
  -- of the table it runs for.
  IF TG_TABLE_NAME = 'invoice_line' THEN
    IF TG_OP = 'DELETE' THEN
      v_invoice := OLD."invoiceId";
    ELSE
      v_invoice := NEW."invoiceId";
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_invoice := OLD.id;
    ELSE
      v_invoice := NEW.id;
    END IF;
  END IF;

  SELECT i."subtotal", i."discountTotal", i."total" INTO v_stated
    FROM public.invoice i WHERE i.id = v_invoice;

  -- Gone by commit time: a draft that was built and rolled back, or a cascade. Nothing to check.
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(sum(l."quantity" * l."unitAmount"), 0), coalesce(sum(l."discount"), 0)
    INTO v_subtotal, v_discount
    FROM public.invoice_line l WHERE l."invoiceId" = v_invoice;

  IF v_stated."subtotal" <> v_subtotal OR v_stated."discountTotal" <> v_discount THEN
    RAISE EXCEPTION
      'invoice % does not add up: header says % less % but the lines say % less %',
      v_invoice, v_stated."subtotal", v_stated."discountTotal", v_subtotal, v_discount
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER invoice_totals_match_lines
  AFTER INSERT OR UPDATE ON "invoice"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.invoice_totals_match_lines();

CREATE CONSTRAINT TRIGGER invoice_line_totals_match_header
  AFTER INSERT OR UPDATE OR DELETE ON "invoice_line"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.invoice_totals_match_lines();

-- 4d. A payment is immutable once recorded (I-3). A bounced cheque is a reversal, which is a
--     status change and a reason — never a quiet edit of the amount.
CREATE OR REPLACE FUNCTION app.payment_is_immutable_once_recorded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a payment is never deleted; reverse it' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed payment cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF NEW."amount" <> OLD."amount"
     OR NEW."currency" <> OLD."currency"
     OR NEW."studentId" <> OLD."studentId"
     OR NEW."receivedOn" <> OLD."receivedOn"
     OR NEW."receiptNo" IS DISTINCT FROM OLD."receiptNo"
  THEN
    RAISE EXCEPTION
      'a recorded payment cannot be changed; reverse it and record the correct one'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER payment_is_immutable_once_recorded
  BEFORE UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION app.payment_is_immutable_once_recorded();

-- 4e. An allocation joins two documents, so the two have to agree: same currency, same child,
--     a live invoice and a live payment.
--
-- The currency check is the one worth stating. Allocating a ₵500 payment to a $500 invoice is
-- arithmetically fine and financially nonsense, and nothing else in the schema would notice.
CREATE OR REPLACE FUNCTION app.allocation_is_coherent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p record;
  i record;
BEGIN
  SELECT "currency", "status"::text, "studentId", "amount"
    INTO p FROM public.payment WHERE id = NEW."paymentId";
  SELECT "currency", "status"::text, "studentId"
    INTO i FROM public.invoice WHERE id = NEW."invoiceId";

  IF p."currency" <> i."currency" THEN
    RAISE EXCEPTION
      'cannot allocate a % payment to a % invoice', p."currency", i."currency"
      USING ERRCODE = '23514';
  END IF;

  IF p."studentId" <> i."studentId" THEN
    RAISE EXCEPTION 'that payment and that invoice belong to different children'
      USING ERRCODE = '23514';
  END IF;

  IF p."status" <> 'RECORDED' THEN
    RAISE EXCEPTION 'a reversed payment cannot settle anything' USING ERRCODE = '23514';
  END IF;

  IF i."status" <> 'ISSUED' THEN
    RAISE EXCEPTION 'only an issued invoice can be paid' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER allocation_is_coherent
  BEFORE INSERT OR UPDATE ON "payment_allocation"
  FOR EACH ROW EXECUTE FUNCTION app.allocation_is_coherent();

-- 4f. Nothing is settled twice.
--
-- Two limits, both deferred because both are sums over rows written across several statements:
--
--   * A payment cannot be allocated for more than was received. Otherwise ₵500 can settle
--     ₵800 of invoices and the school's receivables quietly improve by ₵300.
--   * An invoice cannot be settled for more than it is worth, counting credit notes. Otherwise
--     an overpayment is absorbed into the invoice instead of becoming credit on account, and
--     the family loses money that is theirs.
CREATE OR REPLACE FUNCTION app.settlement_within_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment uuid;
  v_invoice uuid;
  v_allocated numeric;
  v_credited  numeric;
  v_limit     numeric;
BEGIN
  -- Same reason as above: `credit_note` has no `paymentId`, so that column is only ever named
  -- inside the branch that runs for `payment_allocation`.
  IF TG_OP = 'DELETE' THEN
    v_invoice := OLD."invoiceId";
    IF TG_TABLE_NAME = 'payment_allocation' THEN v_payment := OLD."paymentId"; END IF;
  ELSE
    v_invoice := NEW."invoiceId";
    IF TG_TABLE_NAME = 'payment_allocation' THEN v_payment := NEW."paymentId"; END IF;
  END IF;

  IF v_payment IS NOT NULL THEN
    SELECT coalesce(sum(a."amount"), 0) INTO v_allocated
      FROM public.payment_allocation a WHERE a."paymentId" = v_payment;
    SELECT "amount" INTO v_limit FROM public.payment WHERE id = v_payment;

    IF FOUND AND v_allocated > v_limit THEN
      RAISE EXCEPTION
        'that payment is only %, but % has been allocated from it', v_limit, v_allocated
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_invoice IS NOT NULL THEN
    SELECT coalesce(sum(a."amount"), 0) INTO v_allocated
      FROM public.payment_allocation a WHERE a."invoiceId" = v_invoice;
    SELECT coalesce(sum(c."amount"), 0) INTO v_credited
      FROM public.credit_note c WHERE c."invoiceId" = v_invoice;
    SELECT "total" INTO v_limit FROM public.invoice WHERE id = v_invoice;

    IF FOUND AND (v_allocated + v_credited) > v_limit THEN
      RAISE EXCEPTION
        'that invoice is only %, but % of payment and % of credit have been applied to it',
        v_limit, v_allocated, v_credited
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER settlement_within_limits
  AFTER INSERT OR UPDATE OR DELETE ON "payment_allocation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.settlement_within_limits();

CREATE CONSTRAINT TRIGGER credit_within_invoice
  AFTER INSERT OR UPDATE ON "credit_note"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.settlement_within_limits();

-- 4g. A credit note reduces an issued invoice, in the invoice's own currency.
CREATE OR REPLACE FUNCTION app.credit_note_is_coherent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE i record;
BEGIN
  SELECT "currency", "status"::text INTO i FROM public.invoice WHERE id = NEW."invoiceId";

  IF i."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'a credit note must be in the invoice''s currency (%)', i."currency"
      USING ERRCODE = '23514';
  END IF;

  IF i."status" <> 'ISSUED' THEN
    RAISE EXCEPTION 'only an issued invoice can be credited' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER credit_note_is_coherent
  BEFORE INSERT OR UPDATE ON "credit_note"
  FOR EACH ROW EXECUTE FUNCTION app.credit_note_is_coherent();

REVOKE ALL ON FUNCTION app.invoice_is_immutable_once_issued() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.invoice_line_requires_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.invoice_totals_match_lines() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.payment_is_immutable_once_recorded() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.allocation_is_coherent() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settlement_within_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.credit_note_is_coherent() FROM PUBLIC;

COMMENT ON FUNCTION app.invoice_is_immutable_once_issued() IS
  'I-3 for invoices: once issued, correct by credit note, never by an edit.';
COMMENT ON FUNCTION app.settlement_within_limits() IS
  'A payment cannot settle more than was received, and an invoice cannot be settled for more than it is worth.';
