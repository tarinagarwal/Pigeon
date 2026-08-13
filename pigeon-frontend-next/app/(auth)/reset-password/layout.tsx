import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: "noindex, nofollow",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
