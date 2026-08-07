"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";


export const getUserById = async (id:string)=>{
        return db.user.findUnique({
            where:{id},
            include:{accounts:true}
        })
}

export const getAccountByUserId = async (userId:string)=>{
        return db.account.findFirst({
            where:{
                userId
            }
        })
}

export const currentUser = async()=>{
    const user = await auth()
    return user?.user;
}
