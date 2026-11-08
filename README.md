# OBJY Client

<p align="center"><strong>The small, dependency-free client for OBJY DB.</strong></p>

`@objy/client` connects browser and Node.js applications to a running OBJY DB server. It handles authentication, token renewal, database and collection context, queries, streaming imports, files, cancellation, and native server errors without adding an ORM.

Use `@objy/client` for HTTP access. Use [`@objy/db`](https://github.com/objy-org/objy) when the database should run directly inside the application or browser.

[Connect](#connect) · [Core API](#core-api) · [HTTP API](https://github.com/objy-org/objy/blob/main/API.md) · [OBJY DB](https://github.com/objy-org/objy)

## Connect

The same package and import work in Node.js and browser applications:

```sh
npm install @objy/client
```

```js
import { createClient } from '@objy/client';

const client = createClient({ url: 'http://127.0.0.1:8080' });
await client.login({ username: 'admin', password: 'your-password' });

const items = client.database('app').collection('items');

await items.insert({ _id: 'hello', title: 'Hello' });
console.log(await items.find({ title: 'Hello' }));
```

The database and collection must already exist. Administrative setup is covered below. The package has no runtime dependencies and never starts or loads the server.

## Client Model

```text
client
  database("app")
    collection("items")
```

Database and collection handles are immutable. Creating a handle does not create server-side state or change global context, so one client can safely work across many databases:

```js
const activeItems = client.database('app').collection('items');
const oldItems = client.database('archive').collection('items');
```

Methods return native server results:

- Single writes and reads return objects.
- Queries and aggregations return arrays.
- Bulk operations return counts and item summaries.
- Successful `204` deletions return `undefined`.
- Missing objects throw `ObjyDBError` with status `404`.

## Core API

| Handle | Methods |
| --- | --- |
| Client | `login`, `renew`, `getSession`, `setSession`, `logout`, `health`, `status`, `listDatabases`, `createDatabase`, `database` |
| Database | `collection`, `listCollections`, `createCollection`, `drop` |
| Collection | `get`, `insert`, `replace`, `patch`, `remove`, `find`, `search`, `count`, `iterate` |
| Multiple objects | `insertMany`, `replaceMany`, `patchMany`, `removeMany`, `import` |
| Files | `insertFile`, `replaceFile`, `download` |
| Metadata | `getMeta`, `setMeta`, `drop` |

### Administrative Setup

A global administrator can create databases and collections:

```js
await client.createDatabase('app', {
  meta: { purpose: 'demo' },
  adminUser: {
    collection: 'users',
    username: 'owner',
    password: 'your-password',
  },
});

const app = client.database('app');
await app.createCollection('items', { indexes: ['status'] });
```

### Object Operations

```js
const items = client.database('app').collection('items');

await items.insert({ _id: 'hello', title: 'Hello', status: 'draft' });
await items.replace('hello', { title: 'Full replacement' });

await items.patch('hello', {
  $set: { status: 'active' },
  $unset: ['unused'],
});

console.log(await items.get('hello'));
await items.remove('hello');
```

`replace` stores the complete supplied object and creates it when absent. `patch` uses Mongo-like `$set` and `$unset` semantics.

## Query and Aggregate

Use `find` for compact GET queries and `search` for larger filters, aggregation, and vectors:

```js
const rows = await items.find(
  { status: 'active' },
  { limit: 20, offset: 0, sortBy: '_id', sort: 'asc' },
);

const totals = await items.search({
  status: 'active',
  $aggregate: {
    groupBy: 'category',
    fields: {
      total: { $sum: 'score' },
      count: { $count: true },
    },
  },
});

const nearest = await items.search({
  $vector: { vector: [1, 0, 0], limit: 10 },
});

await items.get('hello', { refDepth: 0 });
```

URL options passed to `find` override controls inside the query body. `count` returns a number through native aggregation.

Iterate through ordinary paged reads without manually managing pages:

```js
for await (const item of items.iterate(
  { status: 'active' },
  { pageSize: 100, limit: 1000 },
)) {
  console.log(item);
}
```

`iterate` requests pages of at most 250 and defaults to `_id` order. Its offset and limit apply to the complete iteration. It is not a snapshot: concurrent writes can change page membership. Vector and aggregate queries are not iterable.

## Large Writes

```js
await items.insertMany(
  [{ _id: 'one' }, { _id: 'two' }],
  { minimal: true },
);

await items.replaceMany([{ _id: 'one', title: 'Replacement' }]);
await items.patchMany([{ _id: 'one', $set: { title: 'Patched' } }]);
await items.removeMany(['one', 'two']);
```

For a large source, `import` sends NDJSON without constructing one large JSON array:

```js
await items.import(new Blob([
  '{"_id":"one","score":1}\n',
  '{"_id":"two","score":2}\n',
]));

await items.import(async function* () {
  yield { _id: 'three', score: 3 };
  yield { _id: 'four', score: 4 };
});

await items.import(
  [{ _id: 'three', $set: { score: 5 } }],
  { operation: 'patch' },
);
```

Operations are `insert` (default), `replace`, `patch`, and `remove`.

<details>
<summary><strong>Import sources and partial commits</strong></summary>

Sources may be NDJSON text, Blob/File, arrays, byte streams, object iterables, or factories returning fresh sources. The client sets NDJSON and minimal-response headers automatically. It never silently buffers a large iterable or splits it into unrelated requests.

Earlier server-side batches may remain committed if a later batch fails. Partial imports report committed counts in the error body.

</details>

## Files

```js
await items.insertFile(
  { _id: 'document', title: 'Notes' },
  new Blob(['hello']),
  { filename: 'notes.txt' },
);

await items.replaceFile(
  'document',
  { title: 'Revised notes' },
  new Blob(['revised']),
);

const response = await items.download('document');
const blob = await response.blob();
```

`download` returns the native `Response`, so callers can read a blob, stream `response.body`, or cancel an abandoned download.

## Sessions

Login defaults to `_global/users`, or authenticate against another user collection:

```js
await client.login({
  database: '_global',
  collection: 'users',
  username: 'admin',
  password: 'your-password',
});

const saved = client.getSession();
client.setSession(saved);

await client.renew();
client.logout();
```

Sessions live in memory and are isolated per client. The application decides whether and where to persist the detached snapshot returned by `getSession()`. Logout clears local state but does not revoke server tokens.

Automatic renewal is enabled by default. Concurrent callers share one safe renewal, and each eligible request replays at most once. Disable this with `autoRenew: false`.

<details>
<summary><strong>Renewal and replay safety</strong></summary>

Automatic replay requires `401`, `code: "ACCESS_TOKEN_EXPIRED"`, and `operationStarted: false`. Generic authentication failures, permission denials, and operations that may have started are never replayed.

Rejected refresh tokens clear the session; transport failures preserve it. Login, renewal, and replay never recursively renew. Logging out or replacing the session during renewal prevents the old identity from returning. Cancelling one waiter does not cancel a shared renewal needed by other requests.

Replayable bodies include JSON, text, Blob/File, arrays, and multipart files. Streams and general iterators need a factory that creates a fresh source; otherwise the client reports `BODY_NOT_REPLAYABLE`. Array imports snapshot their JSON before sending.

Older servers without the explicit expiration marker still work but cannot safely trigger automatic renewal.

</details>

## Errors and Cancellation

```js
import { ObjyDBError } from '@objy/client';

try {
  await items.patch(
    'hello',
    { $set: { status: 'done' } },
    { signal: abortController.signal, timeoutMs: 10_000 },
  );
} catch (error) {
  if (error instanceof ObjyDBError) {
    console.log({
      status: error.status,
      code: error.code,
      body: error.body,
      writeMayHaveSucceeded: error.writeMayHaveSucceeded,
    });
  }
}
```

The default timeout is 30 seconds; `timeoutMs: 0` disables it. The deadline covers source creation, renewal, replay, response parsing, and download consumption. Errors preserve server status, body, and headers. Transport failures never retry writes automatically. A timeout, cancellation, or connection failure after sending a write can set `writeMayHaveSucceeded` to true. Redirects are rejected so credentials never cross origins.

## Runtime Support

TypeScript declarations are included:

```ts
type Item = {
  _id: string;
  title: string;
  status?: string;
};

const items = client.database('app').collection<Item>('items');
```

The client uses the host runtime's `fetch`, `Blob`, `FormData`, and Web Streams APIs. A custom `fetch` implementation may be supplied. Streaming request-body support is detected at runtime; Blob and text imports remain the portable fallback.

For a browser without a build step, import the published package directly:

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@objy/client@0.1.0/index.js';
```

Pin the version in production.

For an application on another origin, enable server CORS:

```js
server: {
  port: 8080,
  cors: {
    origins: ['https://app.example.com'],
  },
}
```

CORS is disabled by default. Preflight permits `Authorization`, `Content-Type`, and `Prefer`; configure additional request headers with `cors.headers`. Authentication uses bearer tokens, not cookies. See the [server guide](https://github.com/objy-org/objy/blob/main/SERVER.md) for deployment configuration.

## Development

Run `npm test` for the focused Node suite. With the OBJY DB repository next to this project, run `npm run test:integration` and `npm run test:browser` for real-server and cross-browser coverage. Override the server checkout with `OBJY_SERVER_ROOT` when needed.

```sh
npx playwright install chromium firefox webkit
```
