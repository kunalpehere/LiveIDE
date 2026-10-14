# Local setup

Use Node.js 22 and npm. Run `npm ci` and `npm run prisma:generate` after cloning the repository.

## Environment configuration

Create a private `.env.local` file in the project root. Environment files are ignored by Git and are not supplied with the repository.

| Setting | Purpose |
| --- | --- |
| `AUTH_SECRET` | A randomly generated authentication secret. |
| `DATABASE_URL` | Your MongoDB connection URI, including a database name. Use a replica set for transaction support. |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | Your GitHub OAuth application credentials, configured together if using GitHub sign-in. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Your Google OAuth application credentials, configured together if using Google sign-in. |
| `ENABLE_MOCK_DB` | Set to `true` only for local development without MongoDB. This also enables guest sign-in. Data is held in memory and lost on restart. |

Generate a secret locally with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Configure an OAuth provider for sign-in when using MongoDB. With a database configured, apply the Prisma schema using `npm run db:push`. Start the app with `npm run dev` and open [localhost:3000](http://localhost:3000).

## Optional collaboration

Set `NEXT_PUBLIC_COLLABORATION_URL` to `ws://localhost:1234` and generate an independent `COLLABORATION_SECRET`. The application and collaboration service must receive the same collaboration secret. Restart the application after changing settings.

With the application running, start the collaboration service in a separate terminal:

```bash
node --env-file=.env.local scripts/collaboration-server.mjs
```

For multiple collaboration instances, an optional `REDIS_URL` enables the Redis relay.

## Optional AI

Set `AI_ENABLED` to `true`, choose `AI_PROVIDER`, and configure `AI_PROVIDER_URL` and `AI_MODEL` for your provider. AI remains disabled until enabled and configured.

## Production configuration

Use your deployment platform's secret settings for credentials. Disable mock and collaboration test modes, use independent random secrets of at least 32 characters, and configure real OAuth providers and MongoDB. Production collaboration requires a secure `wss://` URL and an HTTPS `COLLABORATION_APP_URL`. The public collaboration URL is embedded at build time, so changes require a rebuild.

Keep credentials and local environment files out of Git.
