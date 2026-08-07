import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"
import { guestUser, isGuestSignInEnabled } from "@/lib/development-auth"

const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    providers.push(GitHub({
            clientId:process.env.AUTH_GITHUB_ID,
            clientSecret:process.env.AUTH_GITHUB_SECRET
    }));
}

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(Google({
            clientId:process.env.AUTH_GOOGLE_ID,
            clientSecret:process.env.AUTH_GOOGLE_SECRET,
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
    providers,
} satisfies NextAuthConfig
