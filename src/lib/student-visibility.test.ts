import { describe, expect, it } from 'vitest';

import { P } from '@/lib/permissions';
import {
  guardianContactVisible,
  guardianVisibility,
  isFamilyPrincipal,
  redactStudent,
  staffVisibility,
  type StudentRecord,
} from '@/lib/student-visibility';

const perms = (...codes: string[]) => new Set(codes);

const CHILD: StudentRecord = {
  id: 'student-1',
  reference: 'STU-2026-000123',
  admissionNumber: 'A-0042',
  firstName: 'Kojo',
  lastName: 'Quaye',
  preferredName: null,
  status: 'ENROLLED',
  photoPath: null,
  dateOfBirth: new Date('2015-06-14'),
  addressLine1: '12 Ring Road',
  addressLine2: null,
  city: 'Accra',
  region: 'Greater Accra',
  postalCode: null,
  phoneE164: '+233200000009',
  email: 'kojo@example.test',
  bloodType: 'O+',
  medicalNotes: 'Asthma; inhaler in the office.',
  allergies: 'Peanuts',
  specialNeeds: null,
  beceRawScore: 312,
  beceAggregate: 9,
  beceYear: 2026,
  previousSchool: 'Ridge Preparatory',
};

describe('staff see only what their permissions name', () => {
  it('shows nothing at all to somebody on no roster', () => {
    // §13.5: a field with no entry defaults to nobody. Somebody holding unrelated permissions
    // is exactly that case, and the answer is the empty set rather than the roster level.
    expect(staffVisibility(perms(P.ACADEMIC_YEAR_VIEW))).toEqual({
      identity: false,
      dateOfBirth: false,
      contactDetails: false,
      medicalAlert: false,
      medicalDetail: false,
      guardianContact: false,
      priorAttainment: false,
    });
  });

  it('gives a subject teacher the roster level and nothing else', () => {
    // The single most important case in this file. A teacher holds STUDENT_VIEW_OWN_CLASS and
    // HEALTH_ALERT_VIEW and that is all: a name, and "ask the nurse".
    const v = staffVisibility(perms(P.STUDENT_VIEW_OWN_CLASS, P.HEALTH_ALERT_VIEW));
    expect(v.identity).toBe(true);
    expect(v.medicalAlert).toBe(true);
    expect(v.dateOfBirth).toBe(false);
    expect(v.contactDetails).toBe(false);
    expect(v.medicalDetail).toBe(false);
    expect(v.guardianContact).toBe(false);
    expect(v.priorAttainment).toBe(false);
  });

  it('does not widen a teacher just because the school-wide roster permission exists', () => {
    // STUDENT_VIEW and STUDENT_VIEW_OWN_CLASS reach different CHILDREN, not different fields.
    // Both land on the same roster level here, and the difference is enforced by the query.
    const teacher = staffVisibility(perms(P.STUDENT_VIEW_OWN_CLASS));
    const head = staffVisibility(perms(P.STUDENT_VIEW));
    expect(teacher.identity).toBe(head.identity);
    expect(teacher.contactDetails).toBe(head.contactDetails);
  });

  it('gives the registrar the record they maintain', () => {
    const v = staffVisibility(perms(P.STUDENT_VIEW, P.STUDENT_UPDATE, P.GUARDIAN_VIEW));
    expect(v.dateOfBirth).toBe(true);
    expect(v.contactDetails).toBe(true);
    expect(v.guardianContact).toBe(true);
    expect(v.priorAttainment).toBe(true);
  });

  it('keeps the medical record to whoever holds HEALTH_RECORD_VIEW, which is the nurse', () => {
    // The catalogue grants HEALTH_RECORD_VIEW to NURSE alone. A registrar maintains the record
    // and still does not read the allergies.
    expect(staffVisibility(perms(P.STUDENT_VIEW, P.STUDENT_UPDATE)).medicalDetail).toBe(false);
    expect(staffVisibility(perms(P.STUDENT_VIEW, P.HEALTH_RECORD_VIEW)).medicalDetail).toBe(true);
  });

  it('separates the alert flag from the record, in both directions', () => {
    // Holding the detail permission without the flag one is a misconfiguration rather than a
    // meaningful state, but it must not silently grant the flag.
    const detailOnly = staffVisibility(perms(P.STUDENT_VIEW, P.HEALTH_RECORD_VIEW));
    expect(detailOnly.medicalAlert).toBe(false);
    const flagOnly = staffVisibility(perms(P.STUDENT_VIEW, P.HEALTH_ALERT_VIEW));
    expect(flagOnly.medicalDetail).toBe(false);
  });
});

describe('a guardian sees their own child and no other', () => {
  it('shows nothing about a child who is not theirs', () => {
    expect(guardianVisibility(false)).toEqual({
      identity: false,
      dateOfBirth: false,
      contactDetails: false,
      medicalAlert: false,
      medicalDetail: false,
      guardianContact: false,
      priorAttainment: false,
    });
  });

  it('shows their own child in full, including the medical record', () => {
    const v = guardianVisibility(true);
    expect(v.identity).toBe(true);
    expect(v.medicalDetail).toBe(true);
    expect(v.contactDetails).toBe(true);
  });
});

describe('one guardian does not get another guardian’s number', () => {
  const parent = { principalType: 'GUARDIAN', principalId: 'guardian-a', permissions: perms() };

  it('shows a parent their own contact row', () => {
    expect(guardianContactVisible(parent, 'guardian-a')).toBe(true);
  });

  it('refuses the other parent’s contact row', () => {
    // §6: "a custody dispute is precisely when an address leak causes harm".
    expect(guardianContactVisible(parent, 'guardian-b')).toBe(false);
  });

  it('refuses a guardian with no guardian row of their own', () => {
    expect(
      guardianContactVisible({ principalType: 'GUARDIAN', principalId: null, permissions: perms() }, 'guardian-b'),
    ).toBe(false);
  });

  it('does not widen a guardian who somehow holds GUARDIAN_VIEW', () => {
    // The permission belongs to staff. A guardian who held it still gets the relationship rule,
    // because the rule is about who they are and not what they may do.
    expect(
      guardianContactVisible(
        { principalType: 'GUARDIAN', principalId: 'guardian-a', permissions: perms(P.GUARDIAN_VIEW) },
        'guardian-b',
      ),
    ).toBe(false);
  });

  it('lets staff with GUARDIAN_VIEW ring the emergency contact', () => {
    expect(
      guardianContactVisible({ principalType: 'STAFF', principalId: null, permissions: perms(P.GUARDIAN_VIEW) }, 'guardian-b'),
    ).toBe(true);
  });

  it('refuses staff without it', () => {
    expect(
      guardianContactVisible({ principalType: 'STAFF', principalId: null, permissions: perms() }, 'guardian-b'),
    ).toBe(false);
  });
});

describe('redaction drops fields rather than hiding them', () => {
  it('gives a subject teacher a name and an alert, and nothing to leak', () => {
    const out = redactStudent(CHILD, staffVisibility(perms(P.STUDENT_VIEW_OWN_CLASS, P.HEALTH_ALERT_VIEW)));

    expect(out.firstName).toBe('Kojo');
    expect(out.hasMedicalAlert).toBe(true);

    // Absent, not falsy — the keys are never added, so a template cannot render them and a
    // console.log of the whole object cannot spill them.
    expect('medicalNotes' in out).toBe(false);
    expect('allergies' in out).toBe(false);
    expect('addressLine1' in out).toBe(false);
    expect('dateOfBirth' in out).toBe(false);
    expect('beceAggregate' in out).toBe(false);
  });

  it('tells the nurse what the alert says', () => {
    const out = redactStudent(CHILD, staffVisibility(perms(P.STUDENT_VIEW, P.HEALTH_ALERT_VIEW, P.HEALTH_RECORD_VIEW)));
    expect(out.allergies).toBe('Peanuts');
    expect(out.medicalNotes).toMatch(/Asthma/);
  });

  it('reports no alert to somebody who may not see the flag, rather than the truth', () => {
    const out = redactStudent(CHILD, staffVisibility(perms(P.STUDENT_VIEW)));
    expect(out.hasMedicalAlert).toBe(false);
  });

  it('is a flag and not a leak: a child with nothing on file reads false', () => {
    const well = { ...CHILD, bloodType: null, medicalNotes: null, allergies: null, specialNeeds: null };
    const out = redactStudent(well, staffVisibility(perms(P.STUDENT_VIEW_OWN_CLASS, P.HEALTH_ALERT_VIEW)));
    expect(out.hasMedicalAlert).toBe(false);
  });

  it('returns an id and a flag and literally nothing else to somebody with no roster', () => {
    const out = redactStudent(CHILD, staffVisibility(perms()));
    expect(Object.keys(out).sort()).toEqual(['hasMedicalAlert', 'id']);
  });

  it('gives a parent their own child in full', () => {
    const out = redactStudent(CHILD, guardianVisibility(true));
    expect(out.allergies).toBe('Peanuts');
    expect(out.addressLine1).toBe('12 Ring Road');
  });

  it('gives a parent nothing about another family’s child', () => {
    const out = redactStudent(CHILD, guardianVisibility(false));
    expect(Object.keys(out).sort()).toEqual(['hasMedicalAlert', 'id']);
    expect(out.hasMedicalAlert).toBe(false);
  });
});

describe('who counts as family', () => {
  it('names guardians and students', () => {
    expect(isFamilyPrincipal('GUARDIAN')).toBe(true);
    expect(isFamilyPrincipal('STUDENT')).toBe(true);
  });

  it('lets staff through', () => {
    expect(isFamilyPrincipal('STAFF')).toBe(false);
    expect(isFamilyPrincipal('TEACHER')).toBe(false);
    expect(isFamilyPrincipal('PLATFORM')).toBe(false);
  });
});
