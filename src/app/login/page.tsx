import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Printer } from "lucide-react";
import { Card } from "@/components/ui";
import { getSession, getSettings, homePathFor } from "@/lib/data";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const rawNext = typeof params.next === "string" ? params.next : "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const { profile } = await getSession();
  if (profile) redirect(next !== "/" ? next : homePathFor(profile));

  const settings = await getSettings();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-accent text-white">
            <Printer className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">{settings?.shop_name ?? "Campus Xerox"}</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your college email to order prints.</p>
        </div>
        <Card className="p-5">
          <LoginForm next={next} domains={settings?.allowed_email_domains ?? []} linkError={params.error === "link"} />
        </Card>
        <p className="mt-4 text-center text-xs text-muted">Only students and staff of the college can sign in.</p>
      </div>
    </main>
  );
}
