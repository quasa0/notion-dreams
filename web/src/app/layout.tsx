import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notion Dreams",
  description: "Worker reports for automatic Notion page polishing.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
