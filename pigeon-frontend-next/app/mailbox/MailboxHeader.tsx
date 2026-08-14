"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMailbox } from "@/contexts/MailboxContext";

export function MailboxHeader() {
  const pathname = usePathname();
  const { isAuthenticated, inbox, logout } = useMailbox();
  const isAuthPage =
    pathname === "/mailbox/login" ||
    pathname === "/mailbox/forgot-password" ||
    pathname?.startsWith("/mailbox/reset-password");

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
      <div className="container flex h-14 items-center justify-between px-4">
        <Link href={isAuthenticated ? "/mailbox" : "/mailbox/login"} className="flex items-center gap-2 font-semibold">
          <Mail className="h-5 w-5 text-primary" />
          <span>Pigeon Mailbox</span>
        </Link>
        <div className="flex items-center gap-4">
          {isAuthenticated && inbox && (
            <span className="text-sm text-muted-foreground truncate max-w-[180px]" title={inbox.email}>
              {inbox.email}
            </span>
          )}
          {isAuthenticated && !isAuthPage && (
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => logout()}>
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
