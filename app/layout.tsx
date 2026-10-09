import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-providers";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import { Toaster } from "@/components/ui/sonner";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "LiveIDE — Collaborative Browser IDE",
  description:
    "A browser-based development workspace with live previews, AI assistance, real-time collaboration, access controls, and project history.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  const session = await auth()
  const nonce = (await headers()).get("x-nonce") || undefined;
  const requestId = (await headers()).get("x-request-id") || undefined;
  return (
    <SessionProvider session={session}>
    <html lang="en" suppressHydrationWarning>
      <head><meta name="liveide-request-id" content={requestId} /></head>
      <body
        className="font-sans antialiased"
      >
        <ThemeProvider
        nonce={nonce}
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        >
            <div className="flex flex-col min-h-screen">
              <Toaster/>
              <div className="flex-1">{children}</div>
            </div>
        </ThemeProvider>
      </body>
    </html>
    </SessionProvider>
  );
}
