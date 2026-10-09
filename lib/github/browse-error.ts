import "server-only";

export class BrowseError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryAt?: number) { super(message); }
}
