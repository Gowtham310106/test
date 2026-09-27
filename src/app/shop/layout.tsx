import { SiteHeader } from "@/components/site-header";
import { getSettings, requireProfile } from "@/lib/data";

export default async function ShopLayout({ children }: LayoutProps<"/shop">) {
  const { profile } = await requireProfile({ staff: true });
  const settings = await getSettings();
  return (
    <>
      <SiteHeader profile={profile} shopName={settings?.shop_name ?? "Campus Xerox"} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
