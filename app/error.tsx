"use client";

import { useEffect } from "react";
import { ErrorView } from "@/components/error-view";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Application boundary", error); }, [error]);
  return <ErrorView message="The page could not be loaded. Your saved data has not been changed." reset={reset} />;
}
