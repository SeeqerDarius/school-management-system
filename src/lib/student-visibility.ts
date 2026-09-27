import { P } from '@/lib/permissions';

/**
 * Who sees which field of a child's record.
 *
 * <p>This implements the part of the matrix in `docs/DATA_PRIVACY.md` §4 that the product can
 * express today. That document is normative rather than advisory: §13.5 says **a field with no
 * entry in the matrix defaults to "nobody", not "everybody"**, and this module is built that way
 * round — every field starts hidden and is revealed by a named rule.
 *
 * <h2>Why this is a pure function</h2>
 * The interesting failures are combinations: somebody who holds one permission and not another,
 * a guardian looking at a child who is not theirs. Those are cheap to enumerate exhaustively in
 * a test and expensive to discover in production, so the decision is separated from the query
 * that feeds it and asserted on its own.
 *
 * <h2>Reach and visibility are different questions</h2>
 * This module answers "which fields of a record I am allowed to open". It does **not** answer
 * "which records I may open at all" — that is reach, and it lives in `attendanceReach()` and the
 * query restrictions in `features/students/data.ts`. Getting the second one wrong shows every
 * child in the school; getting the first one wrong shows too much of one child. Both matter and
 * they are not the same check.
 */

/** The field groups of a student record that can be shown or withheld independently. */
export interface StudentFieldVisibility {
  /** Name, preferred name, reference, admission number, status, photo. The roster level. */
  identity: boolean;
  /**
   * Date of birth.
   *
   * <p>Separate from identity on purpose: §4 gives a subject teacher "name, photo, student
   * number, class" and gives the nurse the date of birth. A birthday is what a great many
   * identity-verification questions are built on, so it is not roster data.
   */
  dateOfBirth: boolean;
  /**
   * Home address, personal phone and personal email.
   *
   * <p>§4 hides these from the subject teacher and the class teacher alike, and gives transport
   * a *stop* rather than an address. Only the people who maintain the record itself see them.
   */
  contactDetails: boolean;
  /**
   * That there is something medical on file — a boolean, never the condition.
   *
   * <p>§4 and §5 both say an ordinary teacher sees "alert on file — contact the nurse", and the
   * catalogue already carries `HEALTH_ALERT_VIEW` for exactly that.
   */
  medicalAlert: boolean;
  /**
   * The medical record itself: blood type, allergies, notes, special needs.
   *
   * <p>`HEALTH_RECORD_VIEW` is held by the nurse and nobody else, which is the line §4 draws.
   * This group exists because the schema now stores real medical detail — an earlier version of
   * this module could say the product held none, and that is no longer true.
   */
  medicalDetail: boolean;
  /** Guardian names, relationships and contact details. */
  guardianContact: boolean;
  /**
   * Prior attainment: BECE scores, previous school.
   *
   * <p>Admissions data. It decides placement, it is nobody's business afterwards, and it is the
   * kind of field that ends up on a roster screen because it was in the same table.
   */
  priorAttainment: boolean;
}

const NOTHING: StudentFieldVisibility = {
  identity: false,
  dateOfBirth: false,
  contactDetails: false,
  medicalAlert: false,
  medicalDetail: false,
  guardianContact: false,
  priorAttainment: false,
};

/** Whether this person is a family member rather than staff. */
export function isFamilyPrincipal(principalType: string): boolean {
  return principalType === 'GUARDIAN' || principalType === 'STUDENT';
}

/**
 * What a member of staff may see, from their permissions alone.
 *
 * <p>Staff reach is decided by permission. A guardian's is not — see {@link guardianVisibility}.
 *
 * <p>The entry condition is `STUDENT_VIEW` **or** `STUDENT_VIEW_OWN_CLASS`, because those are
 * the two roster permissions the catalogue actually draws, and a teacher holds only the second.
 * Which *children* each reaches is reach, decided elsewhere; what they see of a child they have
 * legitimately reached is the same roster level either way.
 */
export function staffVisibility(permissions: ReadonlySet<string>): StudentFieldVisibility {
  const onARoster = permissions.has(P.STUDENT_VIEW) || permissions.has(P.STUDENT_VIEW_OWN_CLASS);
  if (!onARoster) return NOTHING;

  // Whoever maintains the record needs the date of birth and the address to maintain it; a
  // teacher reading a roster does not.
  const maintainsTheRecord = permissions.has(P.STUDENT_UPDATE) || permissions.has(P.STUDENT_CREATE);

  return {
    identity: true,
    dateOfBirth: maintainsTheRecord,
    contactDetails: maintainsTheRecord,
    // Granted to anyone who holds it, because it is the flag that tells a teacher to fetch the
    // nurse. Withholding this is the failure mode that hurts a child.
    medicalAlert: permissions.has(P.HEALTH_ALERT_VIEW),
    medicalDetail: permissions.has(P.HEALTH_RECORD_VIEW),
    guardianContact: permissions.has(P.GUARDIAN_VIEW),
    priorAttainment: maintainsTheRecord,
  };
}

/**
 * What a guardian may see about a child.
 *
 * <p>Their own children, in full; any other child, not at all. This cannot be expressed as a
 * permission — two parents at the same school hold identical permissions and must see entirely
 * different records — so it is keyed on the link between them, and `isOwnChild` must come from a
 * query against `guardian_relationship`, never from anything the browser sent.
 *
 * <p>A revoked link is not a link. The query that establishes `isOwnChild` must exclude rows
 * with `revokedAt` set, which is the whole point of the column existing.
 */
export function guardianVisibility(isOwnChild: boolean): StudentFieldVisibility {
  if (!isOwnChild) return NOTHING;

  return {
    identity: true,
    dateOfBirth: true,
    contactDetails: true,
    medicalAlert: true,
    // A parent knows their own child's allergies. This is one of the few places where the family
    // sees more than the class teacher, and it is correct.
    medicalDetail: true,
    // Their own contact details and the fact of the other guardians' existence — see
    // `guardianContactVisible` for whether that includes the other guardian's number.
    guardianContact: true,
    priorAttainment: true,
  };
}

/**
 * Whether one guardian may see another guardian's contact details.
 *
 * <p>**No.** §4 withholds "the other guardian's contact details" from a parent, and §6 explains
 * why in one sentence: "a custody dispute is precisely when an address leak causes harm". The
 * school sees every contact; a parent sees their own entry and the other guardians' names, which
 * is enough to know who else the school will call and not enough to find them.
 *
 * <p>Staff with `GUARDIAN_VIEW` see all of it, because somebody has to ring the emergency
 * contact.
 */
export function guardianContactVisible(
  viewer: { principalType: string; principalId: string | null; permissions: ReadonlySet<string> },
  guardianId: string,
): boolean {
  if (viewer.principalType === 'GUARDIAN') {
    return viewer.principalId !== null && viewer.principalId === guardianId;
  }
  return viewer.permissions.has(P.GUARDIAN_VIEW);
}

/** The fields of a student row this module knows how to withhold. */
export interface StudentRecord {
  id: string;
  reference: string;
  admissionNumber: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  status: string;
  photoPath: string | null;
  dateOfBirth: Date | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  phoneE164: string | null;
  email: string | null;
  bloodType: string | null;
  medicalNotes: string | null;
  allergies: string | null;
  specialNeeds: string | null;
  beceRawScore: number | null;
  beceAggregate: number | null;
  beceYear: number | null;
  previousSchool: string | null;
}

export type RedactedStudent = Pick<StudentRecord, 'id'> & Partial<StudentRecord> & {
  /** True when anything medical is on file, whatever it says. Safe to show with the flag alone. */
  hasMedicalAlert: boolean;
};

/**
 * Drops every field the viewer may not see, rather than relying on the template not to render it.
 *
 * <p>Built by adding what is allowed to an empty object, never by deleting from a full one. The
 * deleting form is one forgotten key away from a leak, and the forgotten key is always the one
 * added later by somebody who never read this file.
 */
export function redactStudent(
  student: StudentRecord,
  visibility: StudentFieldVisibility,
): RedactedStudent {
  const hasMedicalAlert = Boolean(
    student.bloodType || student.medicalNotes || student.allergies || student.specialNeeds,
  );

  const out: RedactedStudent = {
    id: student.id,
    // Never conditional. It is a boolean about whether to ask the nurse, not a medical fact,
    // and a viewer who may not even see it gets `false` rather than the truth.
    hasMedicalAlert: visibility.medicalAlert ? hasMedicalAlert : false,
  };

  if (visibility.identity) {
    out.reference = student.reference;
    out.admissionNumber = student.admissionNumber;
    out.firstName = student.firstName;
    out.lastName = student.lastName;
    out.preferredName = student.preferredName;
    out.status = student.status;
    out.photoPath = student.photoPath;
  }

  if (visibility.dateOfBirth) out.dateOfBirth = student.dateOfBirth;

  if (visibility.contactDetails) {
    out.addressLine1 = student.addressLine1;
    out.addressLine2 = student.addressLine2;
    out.city = student.city;
    out.region = student.region;
    out.postalCode = student.postalCode;
    out.phoneE164 = student.phoneE164;
    out.email = student.email;
  }

  if (visibility.medicalDetail) {
    out.bloodType = student.bloodType;
    out.medicalNotes = student.medicalNotes;
    out.allergies = student.allergies;
    out.specialNeeds = student.specialNeeds;
  }

  if (visibility.priorAttainment) {
    out.beceRawScore = student.beceRawScore;
    out.beceAggregate = student.beceAggregate;
    out.beceYear = student.beceYear;
    out.previousSchool = student.previousSchool;
  }

  return out;
}
