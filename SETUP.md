# Environment Setup Guide

## Quick Setup for Development

1. **Create a `.env.local` file** in the root directory with the following content:

```env
# Database (recommended)
DATABASE_URL="mongodb://localhost:27017/liveide"

# Explicit in-memory mode for local development only. Data is lost on restart.
# Remove DATABASE_URL and set this to true when intentionally using mock data.
ENABLE_MOCK_DB="false"

# NextAuth Configuration (required)
AUTH_SECRET="your-super-secret-auth-key-change-this-in-production"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-super-secret-auth-key-change-this-in-production"

# OAuth Providers (optional for now)
# AUTH_GOOGLE_ID=""
# AUTH_GOOGLE_SECRET=""
# AUTH_GITHUB_ID=""
# AUTH_GITHUB_SECRET=""
```

2. Configure at least one OAuth provider before testing sign-in.

3. To intentionally run without MongoDB, set `ENABLE_MOCK_DB="true"` in development. Mock mode is rejected in production.

## What's Fixed

✅ **Starter Templates**: All framework templates are now available
✅ **Mock Database**: No more database connection errors
✅ **Template Loading**: The 500 error should be resolved
✅ **React 19 Compatibility**: Dependencies updated

## Testing the Playground

1. Start the development server: `npm run dev`
2. Open a project from the dashboard, or create one from a starter template.
3. The template should now load without the 500 error

## Next Steps

- MongoDB-backed playgrounds persist across restarts.
- Mock playgrounds are stored in memory and are development-only.
- For databases created before native JSON storage, run `npm run db:migrate-template-content` once.
- After schema changes, apply indexes and defaults with `npm run db:push`.
