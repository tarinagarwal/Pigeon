"use client";

import { ReactNode } from "react";

interface LoginLayoutProps {
  children: ReactNode;
}

export default function LoginLayout({ children }: LoginLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center p-4">
      {children}
    </div>
  );
}