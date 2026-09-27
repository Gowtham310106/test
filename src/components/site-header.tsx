import Link from "next/link";
import { LogOut, Printer } from "lucide-react";
import type { Profile } from "@/lib/types";

const STUDENT_LINKS = [
  { href: "/orders", label: "My orders" },
  { href: "/orders/new", label: "New order" },
  { href: "/profile", label: "Profile" },
];

const STAFF_LINKS = [
  { href: "/shop", label: "Queue" },
  { href: "/shop/prices", label: "Prices" },
  { href: "/shop/stats", label: "Pilot stats" },
];

export function SiteHeader({ profile, shopName }: { profile: Profile | null; shopName: string }) {
  const links = !profile
    ? []
    : profile.role === "student"
      ? STUDENT_LINKS
      : [...STAFF_LINKS, ...(profile.role === "admin" ? [{ href: "/shop/settings", label: "Settings" }] : [])];

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-white">
            <Printer className="size-4" aria-hidden />
          </span>
          <span className="hidden sm:inline">{shopName}</span>
        </Link>
        <nav className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted hover:bg-surface-muted hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        {profile ? (
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface-muted hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
