import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";
import { getSettings, homePathFor, requireProfile } from "@/lib/data";
import { isProfileComplete } from "@/lib/types";

export const metadata: Metadata = { title: "Your details" };

export default async function OnboardingPage() {
  const { profile } = await requireProfile({ complete: false });
  if (isProfileComplete(profile)) redirect(homePathFor(profile));
  const settings = await getSettings();

  return (
    <>
      <SiteHeader profile={null} shopName={settings?.shop_name ?? "Campus Xerox"} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <h1 className="text-xl font-semibold">Your details</h1>
        <p className="mt-1 mb-5 text-sm text-muted">
          {profile.role === "student"
            ? "The shop uses these to know whose order it is and to reach you if something is wrong with a file."
            : "Your name is shown on orders you handle."}
        </p>
        <Card className="p-5">
          <ProfileForm profile={profile} departments={settings?.departments ?? []} onboarding />
        </Card>
      </main>
    </>
  );
}
