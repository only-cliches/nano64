### Storing Nano64 IDs as Signed Integers

While [storing IDs as binary](https://github.com/only-cliches/nano64#database-usage) is the most direct method, most databases and frameworks work more easily with native integer types. It's possible to store `Nano64` IDs in a standard signed 64-bit integer column (`BIGINT` or `INTEGER`).

The **`SignedNano64`** utility class is designed for this purpose. It converts IDs to and from a signed `bigint` format while **perfectly preserving their sort order**, which is critical for time-based range queries.

-----

> ⚠️ **CRITICAL WARNING**
>
> The signed `bigint` representation is **only for database storage**. Never pass a signed integer from your database directly to `Nano64.fromBigInt()` or the `Nano64` constructor. Doing so will completely break the sort order and lead to incorrect data or errors.
>
> **Always** use `SignedNano64.fromNano64()` to convert IDs **before** writing to the database, and **always** use `SignedNano64.toNano64()` to convert them back **after** reading from the database.

-----

### Recommended Column Types

| DBMS | Column Type | Notes |
| :--- | :--- | :--- |
| SQLite | `INTEGER` | The native type for storing signed integers up to 8 bytes. |
| PostgreSQL | `BIGINT` | The standard 64-bit signed integer type. Alias: `INT8`. |
| MySQL 8+ | `BIGINT` | The standard 64-bit signed integer type. |
| MariaDB | `BIGINT` | Same as MySQL. |
| SQL Server | `BIGINT` | The standard 64-bit signed integer type. |
| Oracle | `NUMBER(19)` | The standard way to represent a 64-bit signed integer. |
| CockroachDB | `BIGINT` | PostgreSQL-compatible 64-bit signed integer. Alias: `INT8`.|
| DuckDB | `BIGINT` | The standard 64-bit signed integer type. Alias: `INT64`. |

-----

### SQLite Example

This example demonstrates the correct workflow for storing and querying IDs as signed integers.

```js
import Database from "better-sqlite3";
import { Nano64, SignedNano64 } from "nano64";

// 1. Setup the database with an INTEGER primary key
const db = new Database(":memory:");
db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, message TEXT)");

// 2. Generate Nano64 IDs as usual
const id1 = Nano64.generate(Date.now() - 2000);
const id2 = Nano64.generate(Date.now() - 1000);
const id3 = Nano64.generate(Date.now());  

// 3. Convert IDs to signed bigints before inserting
const insert = db.prepare("INSERT INTO events (id, message) VALUES (?, ?)");
insert.run(SignedNano64.fromNano64(id1), "Event from 2s ago");
insert.run(SignedNano64.fromNano64(id2), "Event from 1s ago");
insert.run(SignedNano64.fromNano64(id3), "Event from now");

// 4. Generate a signed bigint range for the query
const tsEnd = Date.now();
const tsStart = tsEnd - 1500;
const [ start, end] = SignedNano64.timeRangeToSignedBigInts(tsStart, tsEnd);

// 5. Query using the signed bigint bounds
const query = db.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?");
const results = query.all(start, end);

// The query correctly finds the last two records
console.log(`Found ${results.length} events between ${new Date(tsStart).toISOString()} and ${new Date(tsEnd).toISOString()}`);

for (const row of results) {
  // 6. Convert the signed bigint from the DB back to a Nano64 object
  const found = SignedNano64.toNano64(row.id);
  console.log(`- ${found.toHex()} @ ${found.toDate().toISOString()} → ${row.message}`);
}
```