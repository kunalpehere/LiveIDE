"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client-monitoring";
import { ErrorView } from "@/components/error-view";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { reportClientError("react.boundary", error); }, [error]);
  return <html lang="en"><body><ErrorView title="LiveIDE encountered an error" message="Reload the application to continue." reset={retry} /></body></html>;
}
