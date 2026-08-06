import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@patchbay/ui";
import { Nav } from "@/components/nav";
import { LogoutButton } from "@/components/logout-button";
import { getSessionUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Patchbay", template: "%s · Patchbay" },
  description: "Governed API-change remediation platform",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <Link href="/" className="flex items-center gap-2" aria-label="Patchbay home">
                  <span className="flex size-7 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
                    P
                  </span>
                  <span className="text-lg font-semibold tracking-tight">Patchbay</span>
                </Link>
                <Badge tone="blue">Demo data</Badge>
              </div>
              {user ? (
                <div className="flex items-center gap-3">
                  <Nav />
                  <div className="hidden items-center gap-3 border-l border-slate-200 pl-3 md:flex">
                    <div className="text-right">
                      <p className="text-xs font-medium text-slate-900">{user.name}</p>
                      <p className="text-xs text-slate-500">{user.role.toLowerCase()}</p>
                    </div>
                    <LogoutButton />
                  </div>
                </div>
              ) : (
                <Nav />
              )}
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

          <footer className="border-t border-slate-200 bg-white">
            <div className="mx-auto w-full max-w-6xl px-4 py-3 text-xs text-slate-500">
              Patchbay local development MVP. The bundled validation sandbox and dev authentication
              are not hardened multi-tenant infrastructure.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
