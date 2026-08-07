"use client";

import { ErrorView } from "@/components/error-view";

export default function PlaygroundError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView title="Playground unavailable" message="We could not load this playground. Retry without losing saved changes." reset={reset} />;
}
