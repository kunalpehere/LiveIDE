"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client-monitoring";
import { ErrorView } from "@/components/error-view";

export default function ApplicationError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { reportClientError("react.boundary", error); }, [error]);
  return <ErrorView message="The page could not be loaded. Your saved data has not been changed." reset={retry} />;
}
