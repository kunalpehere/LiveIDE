import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Chrome, Github, UserRound } from "lucide-react";
import { signIn } from "@/auth";
import { isGuestSignInEnabled } from "@/lib/development-auth";
import { invitationReturnPath } from "@/lib/auth-routing";

async function handleGoogleSignIn(returnPath: string){
"use server"
await signIn("google", { redirectTo: invitationReturnPath(returnPath) })
}

async function handleGithubSignIn(returnPath: string){
"use server"
await signIn("github", { redirectTo: invitationReturnPath(returnPath) })
}

async function handleGuestSignIn(returnPath: string){
"use server"
await signIn("guest", { redirectTo: invitationReturnPath(returnPath) })
}

const SignInFormClient = ({ returnPath = "/dashboard" }: { returnPath?: string }) => {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold text-center">
          Sign In
        </CardTitle>
        <CardDescription className="text-center">
          Choose your preferred sign-in method
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {isGuestSignInEnabled() && (
          <form action={handleGuestSignIn.bind(null, returnPath)}>
            <Button type="submit" className="w-full">
              <UserRound className="mr-2 h-4 w-4" />
              <span>Continue as guest</span>
            </Button>
          </form>
        )}
        {process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && <form action={handleGoogleSignIn.bind(null, returnPath)}>
          <Button type="submit" variant={"outline"} className="w-full">
            <Chrome className="mr-2 h-4 w-4" />
            <span>Sign in with google</span>
          </Button>
        </form>}
        {process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && <form action={handleGithubSignIn.bind(null, returnPath)}>
          <Button type="submit" variant={"outline"} className="w-full">
            <Github className="mr-2 h-4 w-4" />
            <span>Sign in with github</span>
          </Button>
        </form>}
      </CardContent>

      <CardFooter>
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 w-full">
          By signing in, you agree to our{" "}
          <a href="#" className="underline hover:text-primary">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="underline hover:text-primary">
            Privacy Policy
          </a>
          .
        </p>
      </CardFooter>
    </Card>
  );
};

export default SignInFormClient;
