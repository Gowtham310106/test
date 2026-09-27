import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getSettings, requireProfile } from "@/lib/data";

export default async function StudentLayout({ children }: LayoutProps<"/">) {
  const { profile } = await requireProfile();
  if (profile.role !== "student") redirect("/shop");
  const settings = await getSettings();

  return (
    <>
      <SiteHeader profile={profile} shopName={settings?.shop_name ?? "Campus Xerox"} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
