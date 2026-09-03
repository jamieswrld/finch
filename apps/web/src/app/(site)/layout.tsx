import { Footer } from "@/components/site/Footer";
import { Nav } from "@/components/site/Nav";

/** Marketing surface — landing, research, docs. The app lives behind /app. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  );
}
