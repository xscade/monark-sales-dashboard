import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monark Sales Intelligence",
  description: "Lead CRM, walk-in tracking and offline conversion attribution.",
  // Internal tool holding customer PII — must never be indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
