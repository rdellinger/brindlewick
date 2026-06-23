import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brindlewick — A Cozy Mountain Town",
  description: "Explore the small mountain town of Brindlewick. Meet its 943 residents, uncover gentle mysteries, and find your own pace.",
  openGraph: {
    title: "Brindlewick",
    description: "A cozy text adventure in a mountain valley town.",
    siteName: "Brindlewick",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
