### Storing Nano64 IDs as Signed Integers

While [storing IDs as binary](https://github.com/only-cliches/nano64#database-usage) is the most direct method, many databases, ORMs, and drivers work more easily with native integer types.

The **`SignedNano64`** utility class bridges this gap by converting IDs to and from signed 64-bit integers (`BIGINT` or `INTEGER`) while **perfectly preserving their sort order** — which is critical for time-based range queries.

---

> ⚠️ **Critical Warning**
>
> ⚠️ **Never use a signed bigint value directly with `Nano64`.**  
> The signed format is **only for storage**, not decoding.  
> Passing an integer from your database to `Nano64.fromUnsignedBigInt()` or the `Nano64` constructor will lead to an incorrect timestamp and destroy sort order.
>  
> ✅ Always use `SignedNano64.fromId()` **before writing**, and  
> ✅ Always use `SignedNano64.toId()` **after reading**.

---

### Recommended Column Types

| DBMS | Column Type | Notes |
| :--- | :--- | :--- |
| SQLite | `INTEGER` | Native signed 8-byte integer type. |
| PostgreSQL | `BIGINT` | Standard 64-bit signed integer. Alias: `INT8`. |
| MySQL 8+ | `BIGINT` | Standard 64-bit signed integer type. |
| MariaDB | `BIGINT` | Same as MySQL. |
| SQL Server | `BIGINT` | Standard 64-bit signed integer type. |
| Oracle | `NUMBER(19)` | Standard representation of a 64-bit signed integer. |
| CockroachDB | `BIGINT` | PostgreSQL-compatible 64-bit integer. Alias: `INT8`. |
| DuckDB | `BIGINT` | Standard 64-bit signed integer type. Alias: `INT64`. |

All of these compare signed integers numerically, preserving Nano64’s natural order when stored through `SignedNano64`.

---

### Example: SQLite with Signed Storage

```ts
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
// using the SigneNano64 class to convert and store the Ids
insert.run(SignedNano64.fromId(id1), "Event from 2s ago");
insert.run(SignedNano64.fromId(id2), "Event from 1s ago");
insert.run(SignedNano64.fromId(id3), "Event from now");

// 4. Generate signed bigint bounds for a time range
const tsEnd = Date.now();
const tsStart = tsEnd - 1500;
const [start, end] = SignedNano64.timeRangeToBigInts(tsStart, tsEnd);

// 5. Query using signed bigint range
const query = db.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?");
const results = query.all(start, end);

console.log(`Found ${results.length} events between ${new Date(tsStart).toISOString()} and ${new Date(tsEnd).toISOString()}`);

for (const row of results) {
  // 6. Convert signed bigint from DB back into a Nano64
  const found = SignedNano64.toId(row.id);
  console.log(`- ${found.toHex()} @ ${found.toDate().toISOString()} → ${row.message}`);
}
```

