import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, FileUp, IndianRupee, Printer, SlidersHorizontal, Ticket } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { getSession, getSettings, homePathFor } from "@/lib/data";

const STEPS = [
  { icon: FileUp, title: "Upload", body: "PDF, Word file or photos from class. Pages are counted automatically." },
  { icon: SlidersHorizontal, title: "Choose", body: "B&W or colour, which pages and how many copies. See the price instantly." },
  { icon: IndianRupee, title: "Pay", body: "UPI or card online, or pay in cash when you collect." },
  { icon: Printer, title: "Shop prints", body: "Your order joins a clear queue with every instruction written out." },
  { icon: Bell, title: "Collect", body: "Get notified when it's ready and show your token number. No waiting in line." },
];

export default async function Home() {
  const { profile } = await getSession();
  if (profile) redirect(homePathFor(profile));
  const settings = await getSettings();

  return (
    <>
      <SiteHeader profile={null} shopName={settings?.shop_name ?? "Campus Xerox"} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-16">
        <section className="max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
            <Ticket className="size-4" aria-hidden /> Skip the crowd at the counter
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Order your prints from class. Collect them when they&apos;re ready.
          </h1>
          <p className="mt-4 text-lg text-muted">
            Send your files to the campus Xerox shop from anywhere, pay online or at the counter, and pick up your prints
            with a short token number.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-lg bg-accent px-5 font-medium text-white hover:bg-accent-strong"
            >
              Sign in with college email
            </Link>
          </div>
          {settings && !settings.accepting_orders ? (
            <p className="mt-4 text-sm text-warning">{settings.closed_message}</p>
          ) : null}
        </section>

        <section className="mt-14" aria-labelledby="how">
          <h2 id="how" className="text-sm font-semibold tracking-wide text-muted uppercase">
            How it works
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                    {i + 1}
                  </span>
                  <s.icon className="size-4 text-muted" aria-hidden />
                </div>
                <h3 className="mt-3 font-medium">{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-medium">College accounts only</h3>
            <p className="mt-1 text-sm text-muted">Sign in with your college email. Outsiders can&apos;t crowd the queue.</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-medium">Your files stay private</h3>
            <p className="mt-1 text-sm text-muted">
              Only the shop can open them, and they&apos;re deleted automatically {settings?.file_retention_days ?? 7} days after
              the order.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-medium">A4, B&amp;W or colour</h3>
            <p className="mt-1 text-sm text-muted">Full file, from a page, up to a page or any range, with as many copies as you need.</p>
          </div>
        </section>
      </main>
    </>
  );
}
