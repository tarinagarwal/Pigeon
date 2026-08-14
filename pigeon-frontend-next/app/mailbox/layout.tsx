import type { Metadata } from "next";
import { MailboxProvider } from "@/contexts/MailboxContext";
import { MailboxHeader } from "./MailboxHeader";

export const metadata: Metadata = {
  title: "Mailbox | Pigeon AI",
  description: "Sign in to your mailbox to view and manage emails.",
  robots: "noindex, nofollow",
};

export default function MailboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MailboxProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <MailboxHeader />
        <main className="flex-1">{children}</main>
      </div>
    </MailboxProvider>
  );
}
