const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Welcome to Hono Node.js Starter!' });
});

app.get('/api/hello', (c) => {
  return c.json({ message: 'Hello from Hono API!' });
});

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
});
