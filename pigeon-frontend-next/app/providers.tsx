"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/ConfirmDialog";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        // Light only: the toggle was removed, and forcedTheme also overrides any
        // "dark" value already sitting in a visitor's localStorage.
        forcedTheme="light"
        defaultTheme="light"
        enableSystem={false}
        storageKey="pigeon-theme"
      >
        <AuthProvider>
          <TooltipProvider>
            <ConfirmDialogProvider>
              {children}
              <Toaster richColors position="bottom-center" />
            </ConfirmDialogProvider>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
