"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorView({ title = "Something went wrong", message, reset }: {
  title?: string;
  message: string;
  reset: () => void;
}) {
  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
        <Button onClick={reset}><RefreshCw className="h-4 w-4" />Try again</Button>
      </div>
    </main>
  );
}
