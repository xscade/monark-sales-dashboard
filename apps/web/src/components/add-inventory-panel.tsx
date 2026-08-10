"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, SubmitButton } from "@/components/ui";
import { createUnitAction } from "@/lib/commercial-actions";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

/**
 * Adding stock is a rare, deliberate act; reading the board is the daily one.
 * A permanently open ten-field form pushed the actual inventory below the fold
 * every time somebody just wanted to look something up.
 */
export function AddInventoryPanel({ projects }: { projects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
        {open ? <X aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
        {open ? "Close" : "Add inventory"}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <Card
          className="mt-3"
          title="Add inventory"
          subtitle="Project and unit number form the commercial identity."
        >
          <form action={createUnitAction} className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Project *</span>
              <select name="projectId" required className={inputClass}>
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <Field label="Tower" name="tower" placeholder="A" />
            <Field label="Unit number *" name="unitNumber" required placeholder="1204" />
            <Field label="Floor" name="floor" type="number" />
            <Field label="Configuration *" name="configuration" required placeholder="3 BHK" />
            <Field label="Carpet area (sq ft)" name="carpetAreaSqft" type="number" step="0.01" />
            <Field label="Saleable area (sq ft)" name="saleableAreaSqft" type="number" step="0.01" />
            <Field label="Facing" name="facing" placeholder="East" />
            <Field label="Base price" name="basePrice" type="number" step="0.01" />
            <Field label="All-in price" name="allInPrice" type="number" step="0.01" />
            <div className="flex items-end sm:col-span-2">
              <SubmitButton className="w-full">Add unit</SubmitButton>
            </div>
          </form>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({
  label,
  name,
  ...props
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input name={name} {...props} className={inputClass} />
    </label>
  );
}
