# Collaboration scaling

LiveIDE can run one or many collaboration-server processes. MongoDB stores
durable Yjs snapshots; Redis Pub/Sub distributes live document and awareness
updates between processes.

## Environment

Every instance must use the same values for:

```env
COLLABORATION_SECRET=<shared-long-random-secret>
COLLABORATION_APP_URL=https://app.example.com
REDIS_URL=rediss://user:password@redis.example.com:6379
```

Give each process a unique `COLLABORATION_INSTANCE_ID`. When omitted, the
process creates a random UUID. Each process may use its own host/port:

```env
COLLABORATION_HOST=0.0.0.0
COLLABORATION_PORT=1234
COLLABORATION_INSTANCE_ID=collab-1
```

`NEXT_PUBLIC_COLLABORATION_URL` must point at the public WebSocket load
balancer, normally an `wss://` URL. Configure the proxy for WebSocket upgrade
and long-lived connections. Sticky sessions are not required for correctness:
Redis relays active updates, while MongoDB restores state after reconnects.

If `REDIS_URL` is absent, the server intentionally operates in single-instance
mode for local development. If it is present but unavailable, startup fails so
the deployment cannot silently split collaborative rooms.

## Health checks

An HTTP request to the collaboration port returns the instance ID and whether
distributed mode is active:

```json
{
  "status": "ok",
  "service": "liveide-collaboration",
  "instanceId": "collab-1",
  "distributed": true
}
```

## Delivery model

Redis Pub/Sub provides low-latency, at-most-once live delivery. Yjs makes
updates idempotent and mergeable. MongoDB checkpoints provide durable recovery
for instances that disconnect and therefore miss Pub/Sub messages.

