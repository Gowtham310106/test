import type { Metadata } from "next";
import { ProfileForm } from "@/components/profile-form";
import { Card } from "@/components/ui";
import { getSettings, requireProfile } from "@/lib/data";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { profile } = await requireProfile();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Profile</h1>
      <Card className="p-5">
        <ProfileForm profile={profile} departments={settings?.departments ?? []} onboarding={false} />
      </Card>
    </div>
  );
}
