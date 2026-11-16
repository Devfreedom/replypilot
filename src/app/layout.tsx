import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { BRAND, brandPageTitle } from "@/lib/brand";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: brandPageTitle("Overview"),
  description: BRAND.metaDescription,
};

/*
 * Theme initialisation. Runs synchronously before the first paint so the
 * resolved Light/Dark theme is applied without a flash. Preference storage and
 * the System option are shared with src/components/theme.tsx via
 * BRAND.storageThemeKey.
 */
const themeInitScript = `(function(){try{var k=${JSON.stringify(
  BRAND.storageThemeKey,
)};var s=localStorage.getItem(k);var m=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",m);document.documentElement.style.colorScheme=m;}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning className="min-h-full bg-canvas text-ink">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
