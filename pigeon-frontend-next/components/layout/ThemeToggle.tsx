"use client";

import { useEffect, useState } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolved = theme === "dark" ? "dark" : "light";

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        disabled
        aria-label="Theme"
      >
        <Sun className="h-4 w-4 opacity-40" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-white hover:bg-primary transition-colors"
              aria-label="Appearance"
            >
              {resolved === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Appearance</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className="gap-2 cursor-pointer"
        >
          <Sun className="h-3.5 w-3.5 shrink-0" />
          <span>Light</span>
          {resolved === "light" && (
            <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className="gap-2 cursor-pointer"
        >
          <Moon className="h-3.5 w-3.5 shrink-0" />
          <span>Dark</span>
          {resolved === "dark" && (
            <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
