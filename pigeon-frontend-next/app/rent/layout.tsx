import type { Metadata } from "next";
import { RYNProvider } from "@/contexts/RYNContext";

export const metadata: Metadata = {
  title: "Rent Your Network — Earn Credits From Your Email Accounts | Pigeon",
  description: "List your email accounts on the Rent Your Network marketplace. Earn credits passively when others rent your emails for outreach. Free to join, instant setup.",
};

export default function RentLayout({ children }: { children: React.ReactNode }) {
  return (
    <RYNProvider>
      {children}
    </RYNProvider>
  );
}
