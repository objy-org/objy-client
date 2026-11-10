# OBJY Client

<p align="center"><strong>The small, dependency-free JavaScript client for OBJY DB.</strong></p>

`@objy/client` connects browser and Node.js applications to a running OBJY DB server. It handles authentication, database context, object operations, streaming imports, files, cancellation, and native server errors without adding an ORM.

[Connect](#connect) · [Object API](#object-api) · [HTTP API](https://github.com/objy-org/objy/blob/main/API.md) · [OBJY DB](https://github.com/objy-org/objy)

## Connect

The same package and import work in browsers and Node.js:

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

The server, database, and collection must already exist. The package has no runtime dependencies and never starts or loads the database server.

<details>
<summary><strong>Create a database and collection</strong></summary>

A global administrator can create contexts through the same client:

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

</details>

## Object API

```text
client
  database("app")
    collection("items")
```

Database and collection handles are immutable. Creating a handle does not create server state or change global context, so one client can safely work across many databases.

| Handle | Methods |
| --- | --- |
| Client | `login`, `renew`, `getSession`, `setSession`, `logout`, `health`, `status`, `listDatabases`, `createDatabase`, `database` |
| Database | `collection`, `listCollections`, `createCollection`, `drop` |
| Collection | `get`, `insert`, `replace`, `patch`, `remove`, `find`, `search`, `count`, `iterate` |
| Bulk and streams | `insertMany`, `replaceMany`, `patchMany`, `removeMany`, `import` |
| Files | `insertFile`, `replaceFile`, `download` |
| Metadata | `getMeta`, `setMeta`, `drop` |

```js
await items.insert({ _id: 'one', title: 'Draft', status: 'new' });
await items.get('one');
await items.replace('one', { title: 'Replacement', status: 'active' });
await items.patch('one', { $set: { score: 9 }, $unset: ['status'] });
await items.remove('one');
```

`replace` is a complete-object upsert. `patch` supports Mongo-like `$set` and `$unset`.

Single reads and writes return objects, queries and aggregations return arrays, and bulk operations return counts and item summaries. Successful `204` deletions return `undefined`; missing objects throw `ObjyDBError` with status `404`.

## Queries

Use `find` for compact GET queries and `search` for larger filters, aggregation, and vectors:

```js
await items.find({ status: 'active' }, { limit: 20, sortBy: '_id' });
await items.search({
  status: 'active',
  $aggregate: { groupBy: 'category', fields: { total: { $sum: 'score' } } },
});
await items.search({ $vector: { vector: [1, 0, 0], limit: 10 } });
await items.count({ status: 'active' });
await items.get('one', { refDepth: 0 });
```

Options passed to `find` override controls inside its query. See the [HTTP API](https://github.com/objy-org/objy/blob/main/API.md#query) for operators, aggregation, vectors, and live references.

Iterate through ordinary paged reads without managing pages yourself:

```js
for await (const item of items.iterate({ status: 'active' }, { pageSize: 100 })) {
  console.log(item);
}
```

Iteration requests pages of at most 250 and defaults to `_id` order. Its offset and limit apply to the complete iteration. It is not a snapshot: concurrent writes may change page membership. Vector and aggregate queries are not iterable.

## Large Data

Bulk methods keep normal arrays simple:

```js
await items.insertMany([{ _id: 'one' }, { _id: 'two' }], { minimal: true });
await items.replaceMany([{ _id: 'one', title: 'Replacement' }]);
await items.patchMany([{ _id: 'one', $set: { title: 'Patched' } }]);
await items.removeMany(['one', 'two']);
```

For a large source, `import` sends NDJSON without constructing one large JSON array:

```js
await items.import(async function* () {
  yield { _id: 'three', score: 3 };
  yield { _id: 'four', score: 4 };
});

await items.import([{ _id: 'three', $set: { score: 5 } }], { operation: 'patch' });
```

Stream operations are `insert` (default), `replace`, `patch`, and `remove`.

<details>
<summary><strong>Import behavior</strong></summary>

Sources may be NDJSON text, Blob/File, arrays, byte streams, object iterables, or factories returning fresh sources. The client sets NDJSON and minimal-response headers automatically. It never silently buffers a large iterable or splits it into unrelated requests.

Earlier server batches may remain committed if a later batch fails; errors include committed counts. Arrays are snapshotted before sending. Streams and general iterators need a factory to be replayable after token renewal, otherwise the client reports `BODY_NOT_REPLAYABLE`.

</details>

## Files

Files remain attached to normal database objects:

```js
await items.insertFile({ _id: 'document', title: 'Notes' }, new Blob(['hello']), {
  filename: 'notes.txt',
});
await items.replaceFile('document', { title: 'Revised' }, new Blob(['revised']));
const response = await items.download('document');
const blob = await response.blob();
```

`download` returns the native `Response`, so callers may read a blob, stream `response.body`, or cancel an abandoned download.

## Sessions and Errors

Login defaults to `_global/users`, but any configured user collection may authenticate:

```js
await client.login({ database: '_global', collection: 'users', username: 'admin', password: 'your-password' });
const saved = client.getSession();
client.setSession(saved);
await client.renew();
client.logout();
```

Sessions live in memory and remain isolated per client. The application chooses whether to persist the detached session snapshot. Logout clears local state but does not revoke server tokens.

Automatic renewal is enabled by default. Concurrent requests share one renewal and each eligible request replays at most once. Set `autoRenew: false` to disable it.

```js
import { ObjyDBError } from '@objy/client';

try {
  await items.patch('one', { $set: { status: 'done' } }, {
    signal: abortController.signal,
    timeoutMs: 10_000,
  });
} catch (error) {
  if (error instanceof ObjyDBError) {
    console.log(error.status, error.code, error.body, error.writeMayHaveSucceeded);
  }
}
```

The default timeout is 30 seconds; `timeoutMs: 0` disables it. Errors preserve server status, body, and headers. Transport failures never retry writes automatically. A timeout, cancellation, or connection failure after sending a write may set `writeMayHaveSucceeded`.

<details>
<summary><strong>Renewal and replay safety</strong></summary>

Automatic replay requires `401`, `code: "ACCESS_TOKEN_EXPIRED"`, and `operationStarted: false`. Generic authentication failures, permission denials, and operations that may have started are never replayed.

Rejected refresh tokens clear the session; transport failures preserve it. Login, renewal, and replay never recursively renew. Logging out or replacing a session during renewal prevents the old identity from returning. Cancelling one waiter does not cancel a shared renewal needed elsewhere.

Replayable bodies include JSON, text, Blob/File, arrays, and multipart files. Older servers without the explicit expiration marker cannot safely trigger automatic renewal. Redirects are rejected so credentials never cross origins.

The request deadline covers source creation, renewal, replay, response parsing, and download consumption.

</details>

## Runtimes

TypeScript declarations are included:

```ts
type Item = { _id: string; title: string };
const items = client.database('app').collection<Item>('items');
```

The client uses the host's `fetch`, `Blob`, `FormData`, and Web Streams APIs. You may provide a custom `fetch`. Streaming request bodies are detected at runtime; Blob and text imports remain the portable fallback.

Browsers without a build step can import the published package directly:

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@objy/client@0.1.0/index.js';
```

Pin the version in production.
