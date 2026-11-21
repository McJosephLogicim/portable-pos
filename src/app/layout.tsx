import type { Metadata, Viewport } from "next";
import { InputExperience } from "@/components/input-experience";
import { APP_NAME, appIcons } from "@/lib/app-brand";
import "./globals.css";
export const metadata: Metadata = {
  title: APP_NAME,
  description: "A mobile register for food, drinks, and pop-up counters.",
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  icons: { apple: appIcons.apple },
};
export const viewport: Viewport = {
  themeColor: "#f6f6f4",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // Tapping a field or button never zooms the page.
  maximumScale: 1,
  userScalable: false,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <InputExperience />
        {children}
      </body>
    </html>
  );
}
