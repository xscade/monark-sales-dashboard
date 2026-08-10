"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaRegister } from "@/components/pwa-register";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={250}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
        <PwaRegister />
      </TooltipProvider>
    </ThemeProvider>
  );
}
