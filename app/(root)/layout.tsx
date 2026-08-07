
import  {Footer}  from "@/features/home/footer";
import  {Header}  from "@/features/home/header";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: {
        template: "%s | LiveIDE",
        default: "LiveIDE — Collaborative Browser IDE",
    },
};

export default function HomeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-background">
            <Header />
            <main>{children}</main>
            <Footer />
        </div>
    );
}
