import { MarketingNav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/sections";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen overflow-x-clip">
      <MarketingNav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
