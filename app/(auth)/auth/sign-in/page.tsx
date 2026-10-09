import SignInFormClient from '@/features/auth/components/sign-in-form-client'
import Image from 'next/image'
import React from 'react'
import { invitationReturnPath } from '@/lib/auth-routing'

const SignInPage = async ({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) => {
  const returnPath = invitationReturnPath((await searchParams).returnTo);
  return (
    <>
        <Image src={"/login.svg"} alt="Login-Image" height={300} 
        width={300}
        className='m-6 object-cover'
        />
        <SignInFormClient returnPath={returnPath}/>
    </>
  )
}

export default SignInPage
