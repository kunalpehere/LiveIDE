import type { NextPage } from 'next'
import Head from 'next/head'

const Home: NextPage = () => {
  return (
    <div>
      <Head>
        <title>Next.js Starter</title>
        <meta name="description" content="Next.js starter template" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <h1>Welcome to Next.js Starter</h1>
        <p>Get started by editing pages/index.tsx</p>
      </main>
    </div>
  )
}

export default Home
