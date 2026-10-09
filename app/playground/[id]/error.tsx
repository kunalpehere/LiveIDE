"use client";

import { ErrorView } from "@/components/error-view";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client-monitoring";

export default function PlaygroundError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { reportClientError("react.boundary", error); }, [error]);
  return <ErrorView title="Playground unavailable" message="We could not load this playground. Retry without losing saved changes." reset={retry} />;
}
