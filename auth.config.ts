import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"
import { guestUser, isGuestSignInEnabled } from "@/lib/development-auth"
import { getAuthConfiguration } from "@/lib/runtime-config.mjs"

const configuration = getAuthConfiguration();
const providers: NextAuthConfig["providers"] = [];

if (configuration.githubId && configuration.githubSecret) {
    providers.push(GitHub({
            clientId:configuration.githubId,
            clientSecret:configuration.githubSecret
    }));
}

if (configuration.googleId && configuration.googleSecret) {
    providers.push(Google({
            clientId:configuration.googleId,
            clientSecret:configuration.googleSecret,
    }));
}

if (isGuestSignInEnabled()) {
    providers.push(Credentials({
        id: "guest",
        name: "Development guest",
        credentials: {},
        authorize: async () => guestUser,
    }));
}

export default{
    secret: configuration.authSecret,
    providers,
} satisfies NextAuthConfig
