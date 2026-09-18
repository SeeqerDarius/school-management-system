import { redirect } from 'next/navigation';

/**
 * The root.
 *
 * <p>There is no meaningful landing page inside an authenticated product — every user arrives
 * wanting to be somewhere specific. For now that is the academic calendar, the one module that
 * exists. As the role-aware dashboards land this becomes a redirect driven by the signed-in
 * user's principal type: a parent to their wards, a teacher to today's timetable, a bursar to
 * the day's collections (§100).
 */
export default function Home() {
  redirect('/settings/calendar');
}
