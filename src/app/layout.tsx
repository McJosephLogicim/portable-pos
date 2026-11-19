import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PORTABLE POS",
  description: "A mobile register for food, drinks, and pop-up counters.",
  appleWebApp: {
    capable: true,
    title: "Portable POS",
    statusBarStyle: "default",
  },
  icons: { apple: "/apple-touch-icon.png", icon: "/icon-192.png" },
};
export const viewport: Viewport = {
  themeColor: "#f6f6f4",
  viewportFit: "cover",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
