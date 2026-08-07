"use client";

import { useTheme } from "next-themes";
import { useEffect , useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";


export function ThemeToggle(){
    const {setTheme , theme} = useTheme();
    const [mounted , setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    } , []);

    if(!mounted){
        return <span className="block size-9" aria-hidden="true" />;
    }

    return (
        <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Toggle color theme"
        onClick={() => {
            setTheme(theme === "light" ? "dark" : "light");
        }}
        >
            {
                theme === "light" ? (<Moon className="size-4"/>) : (<Sun className="size-4"/>)
            }
        </Button>
    )
}
