"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Trash2, Info, ArrowRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type ConfirmVariant = "default" | "destructive" | "warning";

export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  learnMoreHref?: string;
  learnMoreLabel?: string;
}

interface ConfirmDialogContextValue {
  confirmDialog: (options: ConfirmDialogOptions) => Promise<boolean>;
}

const ConfirmDialogContext = React.createContext<ConfirmDialogContextValue | null>(null);

const defaultOptions: ConfirmDialogOptions = {
  title: "Are you sure?",
  description: "",
  variant: "default",
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
};

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmDialogOptions>(defaultOptions);
  const resolveRef = React.useRef<(value: boolean) => void>(() => {});

  const confirmDialog = React.useCallback((opts: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setOptions({ ...defaultOptions, ...opts });
      resolveRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const handleClose = React.useCallback((confirmed: boolean) => {
    resolveRef.current(confirmed);
    resolveRef.current = () => {};
    setOpen(false);
  }, []);

  const handleOpenChange = React.useCallback(
    (isOpen: boolean) => {
      if (!isOpen) handleClose(false);
    },
    [handleClose]
  );

  const getIcon = () => {
    switch (options.variant) {
      case "destructive":
        return <Trash2 className="h-5 w-5 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      default:
        return <Info className="h-5 w-5 text-primary" />;
    }
  };

  const getConfirmLabel = () => {
    if (options.confirmLabel) return options.confirmLabel;
    return options.variant === "destructive" ? "Delete" : "Confirm";
  };

  return (
    <ConfirmDialogContext.Provider value={{ confirmDialog }}>
      {children}
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                  options.variant === "destructive" && "bg-destructive/10",
                  options.variant === "warning" && "bg-amber-500/10",
                  options.variant === "default" && "bg-primary/10"
                )}
              >
                {getIcon()}
              </div>
              <div className="space-y-2 flex-1 pt-0.5">
                <AlertDialogTitle className="text-left">{options.title}</AlertDialogTitle>
                {options.description && (
                  <AlertDialogDescription className="text-left whitespace-pre-line">
                    {options.description}
                  </AlertDialogDescription>
                )}
                {options.learnMoreHref && options.learnMoreLabel ? (
                  <Link
                    href={options.learnMoreHref}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-2"
                    onClick={() => handleClose(false)}
                  >
                    <span>{options.learnMoreLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                ) : null}
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0 flex-wrap sm:flex-nowrap">
            <AlertDialogCancel onClick={() => handleClose(false)}>
              {options.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleClose(true)}
              className={cn(
                options.variant === "destructive" && "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              )}
            >
              {getConfirmLabel()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): (options: ConfirmDialogOptions) => Promise<boolean> {
  const ctx = React.useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error("useConfirmDialog must be used within ConfirmDialogProvider");
  }
  return ctx.confirmDialog;
}
