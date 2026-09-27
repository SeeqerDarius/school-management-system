/**
 * The shell for pages you reach before you have a school.
 *
 * <p>Deliberately bare: no navigation, because there is nowhere to go yet, and nothing that
 * reveals which schools exist on this deployment.
 */
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <main id="main" className="w-full max-w-sm">
        {children}
      </main>
    </div>
  );
}
