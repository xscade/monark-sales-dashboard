"use client";

import { useState } from "react";
import { ChevronRight, ScrollText } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The timeline is the record, not the workspace.
 *
 * On an active lead it runs to dozens of entries and pushed every actionable
 * card off the screen. Collapsed by default it stays one click away, and the
 * event count on the trigger is usually the only part anyone needed.
 */
export function CollapsibleLogs({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card
        title="Timeline"
        subtitle={`${count} event${count === 1 ? "" : "s"}`}
        action={
          <CollapsibleTrigger className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <ScrollText aria-hidden className="size-3.5" />
            {open ? "Hide logs" : "Open logs"}
            <ChevronRight
              aria-hidden
              className={cn("size-3.5 transition-transform duration-200", open && "rotate-90")}
            />
          </CollapsibleTrigger>
        }
      >
        <CollapsibleContent>{children}</CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
