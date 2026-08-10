"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BookingsError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-4" />
            </span>
            <CardTitle>Booking update could not be completed</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            Review the current booking or inventory state before trying again. Another user may have changed the lead, hold, or unit while this page was open.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={reset}>Try again</Button>
            <Button asChild variant="outline"><Link href="/bookings">Back to booking register</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
