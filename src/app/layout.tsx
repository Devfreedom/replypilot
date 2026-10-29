import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReplyPilot · Dashboard",
  description:
    "Record enquiries, track follow-ups and prepare replies from your own approved business details.",
};

/*
 * Theme initialisation. Runs synchronously before the first paint so the
 * resolved Light/Dark theme is applied without a flash. Preference storage and
 * the System option are shared with src/components/theme.tsx via THEME_STORAGE_KEY.
 */
const themeInitScript = `(function(){try{var k="replypilot-theme";var s=localStorage.getItem(k);var m=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",m);document.documentElement.style.colorScheme=m;}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
