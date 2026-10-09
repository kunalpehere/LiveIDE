interface AuthEnvironment {
  NODE_ENV?: string;
  ENABLE_MOCK_DB?: string;
}

export function isGuestSignInEnabled(environment: AuthEnvironment = process.env) {
  return environment.NODE_ENV === "development" && environment.ENABLE_MOCK_DB === "true";
}

export const guestUser = {
  id: "mock-user-1",
  name: "Local Developer",
  email: "developer@localhost",
} as const;
