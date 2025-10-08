# Nano64 — 64-bit Time-Sortable Identifiers for TypeScript

**Nano64** is a lightweight library for generating time-sortable, globally unique IDs that provide similar practical guarantees to ULID or UUID while using half the storage.  
This reduces index and I/O overhead while preserving cryptographic-grade randomness.  Includes optional monotonic sequencing and AES-GCM encryption for timestamp privacy.

[![GitHub Repo stars](https://img.shields.io/github/stars/only-cliches/nano64)](https://github.com/only-cliches/nano64)
[![NPM Version](https://img.shields.io/npm/v/nano64)](https://www.npmjs.com/package/nano64)
[![JSR Version](https://img.shields.io/jsr/v/%40onlycliches/nano64)](https://jsr.io/@onlycliches/nano64)
[![npm package minimized gzipped size](https://badgen.net/bundlephobia/minzip/nano64?cache=true)](https://bundlephobia.com/package/nano64@latest)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- **Time-sortable:** IDs naturally order by creation time.  
- **Compact:** 8 bytes (16 hex characters).  
- **Deterministic layout:** `[63‥20]=timestamp`, `[19‥0]=random`.  
- **Collision-resistant:** ~1 % collision probability at 145 000 IDs/s.  
- **Cross-database-safe:** Big-endian bytes preserve order in SQLite, PostgreSQL, MySQL, and others.  
- **AES-GCM encryption:** Optionally hides the embedded timestamp.  
- **Unsigned canonical form:** Portable numeric representation `0‥2⁶⁴ − 1`.  
- **Typed and tested:** 100 % TypeScript with full Vitest coverage.

---

## Installation

```bash
npm install nano64
````

---

## Usage

### Basic ID generation

```ts
import { Nano64 } from "nano64";

const id = Nano64.generate();

console.log(id.toHex());        // 17-char uppercase hex TIMESTAMP-RANDOM
// 199C01B6659-5861C
console.log(id.toBytes());      // Uint8Array(8)
// [25,156,1,182,101,149,134,28]
console.log(id.getTimestamp()); // ms since epoch
// 1759864645209
```

---

### Monotonic generation

Ensures strictly increasing values even when created within the same millisecond.

```ts
const a = Nano64.generateMonotonic();
const b = Nano64.generateMonotonic();

console.log(Nano64.compare(a, b)); // -1
```

---

### AES-GCM encryption

Encrypt and decrypt IDs to hide the embedded timestamp from public view.  Encryped IDs can be safely exposed to the internet without providing any timestamp information for the source ID.

```ts
const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
const factory = Nano64.encryptedFactory(key);

// Generate and encrypt
const wrapped = await factory.generateEncrypted();
console.log(wrapped.id.toHex()) // Unencrypted ID
// 199C01B66F8-CB911
console.log(wrapped.toEncryptedHex()); // 72‑char hex payload
// 2D5CEBF218C569DDE077C4C1F247C708063BAA93B4285CD67D53327EA4C374A64395CFF0

// Decrypt later
const restored = await factory.fromEncryptedHex(wrapped.toEncryptedHex());
console.log(restored.id.value === wrapped.id.value); // true
```

---

## Comparison with Other Identifiers

| Property               | **Nano64**                                | **ULID**                    | **UUIDv4**              | **Snowflake ID**             |
| ---------------------- | ----------------------------------------- | --------------------------- | ----------------------- | ---------------------------- |
| Bits total             | 64                                        | 128                         | 128                     | 64                           |
| Encoded timestamp bits | 44                                        | 48                          | 0                       | 41                           |
| Random / entropy bits  | 20                                        | 80                          | 122                     | 22 (per-node sequence)       |
| Sortable by time       | ✅ Yes (lexicographic & numeric)           | ✅ Yes                       | ❌ No                    | ✅ Yes                        |
| Collision risk (1%)    | ~145 IDs/ms                               | ~26M/ms                     | Practically none        | None (central sequence)      |
| Typical string length  | 16 hex chars                              | 26 Crockford base32         | 36 hex+hyphens          | 18–20 decimal digits         |
| Encodes creation time  | ✅                                        | ✅                           | ❌                       | ✅                            |
| Can hide timestamp     | ✅ via AES-GCM encryption                  | ⚠️ Not built-in             | ✅ (no time field)       | ❌ Not by design              |
| Database sort order    | ✅ Stable with big-endian BLOB             | ✅ (lexical)                 | ❌ Random                | ✅ Numeric                    |
| Cryptographic strength | 20-bit random, optional AES               | 80-bit random               | 122-bit random          | None (deterministic)         |
| Dependencies           | None (crypto optional)                    | None                        | None                    | Central service or worker ID |
| Target use             | Compact, sortable, optionally private IDs | Human-readable sortable IDs | Pure random identifiers | Distributed service IDs      |

> Nano64 keeps the chronological behavior of ULIDs but in 64 bits instead of 128, cutting key size by half without sacrificing sort order or safety.

---

## Database Usage

Nano64 IDs are time-sortable, enabling **index-only time-range queries** without needing a separate timestamp column.

### Time-Based Range Queries

Use `Nano64.timeRangeToBytes(startMs, endMs)` to obtain the **lowest** and **highest** possible Nano64 values for a given time window.
These can be used directly in a SQL `BETWEEN` clause to select all rows created within that range.

Using Nano64 as the **primary key** is recommended, since the database’s native index makes these range queries extremely fast.

### Storing Nano64 IDs in SQL

Store IDs as unsigned big-endian bytes using `id.toBytes()` and a byte-ordered column type.

| DBMS        | Column Type |  Notes                                                |
| ----------- | ----------- | ----------------------------------------------------- |
| SQLite      | `BLOB(8)`   | Lexicographic byte order matches unsigned big-endian. |
| PostgreSQL  | `BYTEA(8)`  | Works with primary key indexes.                       |
| MySQL 8+    | `BINARY(8)` | Use binary collation.                                 |
| MariaDB     | `BINARY(8)` | Same as MySQL.                                        |
| SQL Server  | `BINARY(8)` | Clustered index sorts by bytes.                       |
| Oracle      | `RAW(8)`    | Bytewise comparison.                                  |
| CockroachDB | `BYTES(8)`  | Bytewise ordering.                                    |
| DuckDB      | `BLOB(8)`   | Bytewise ordering.                                    |

### SQLite Example

```js
import Database from "better-sqlite3";
import { Nano64 } from "nano64";

const db = new Database(":memory:");
db.exec("CREATE TABLE events (id BLOB PRIMARY KEY, message TEXT)");

// generate IDs
const id1 = Nano64.generate(Date.now() - 2000);
const id2 = Nano64.generate(Date.now() - 1000);
const id3 = Nano64.generate(Date.now());  

// insert records
const insert = db.prepare("INSERT INTO events (id, message) VALUES (?, ?)");
insert.run(Buffer.from(id1.toBytes()), "Event from 2s ago");
insert.run(Buffer.from(id2.toBytes()), "Event from 1s ago");
insert.run(Buffer.from(id3.toBytes()), "Event from now");

// search for rows between now and 1.5 seconds ago
const tsEnd = Date.now();
const tsStart = tsEnd - 1500;

const { start, end } = Nano64.timeRangeToBytes(tsStart, tsEnd);

const query = db.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?");
const results = query.all(Buffer.from(start), Buffer.from(end));

// Will only get 2 rows
console.log(`Found ${results.length} events between ${new Date(tsStart).toISOString()} and ${new Date(tsEnd).toISOString()}`);

for (const row of results) {
  const found = Nano64.fromBytes(row.id);
  console.log(`- ${found.toHex()} @ ${found.toDate().toISOString()} → ${row.message}`);
}
```

---

## API Summary

### `Nano64.generate(timestamp?, rng?)`

Creates a new ID with optional timestamp and RNG.

### `Nano64.generateMonotonic(timestamp?, rng?)`

Same as `generate`, but strictly increasing within the same millisecond.

### `Nano64.fromHex(hex)` / `fromBytes(bytes)` / `fromBigIntUnsigned(v)`

Parse back into a Nano64.

### `id.toHex()` / `id.toBytes()` / `id.toDate()` / `id.getTimestamp()`

Export utilities.

### `Nano64.compare(a,b)` / `id.equals(b)`

Comparison helpers.

### `Nano64.encryptedFactory(key, clock?)`

Returns an object with `encrypt`, `generateEncrypted`, `fromEncryptedBytes`, and `fromEncryptedHex`.

---

## Design

| Bits | Field          | Purpose             | Range          |
| ---- | -------------- | ------------------- | -------------- |
| 44   | Timestamp (ms) | Chronological order | 1970–2527      |
| 20   | Random         | Collision avoidance | 1 048 576 / ms |

Collision characteristics:

* Theoretical: ~1% collision probability at 145 IDs/millisecond
* Real-world sustained rate (145k IDs/sec): <0.05% collision rate
* High-speed burst (3.4M IDs/sec): ~0.18% collision rate
* Concurrent generation (10.6M IDs/sec): ~0.58% collision rate

[Reference: go-nano64 data](https://github.com/Codycody31/go-nano64)

---

## Tests

```bash
npm test
```

All tests are written in Vitest and cover:

* Hex ↔ byte conversions
* BigInt encoding
* Timestamp extraction and monotonic logic
* AES-GCM encryption / decryption integrity
* Overflow and edge-case handling
* BLBO Primary key and range queries with SQLite

---

## Unofficial Ports

* [Go](https://github.com/Codycody31/go-nano64)

---

## License

MIT License

---

## Keywords

```
nano64, ulid, time-sortable, 64-bit id, bigint, aes-gcm, uid, uuid alternative,
distributed id, database key, monotonic id, sortable id, crypto id,
typescript, nodejs, browser, timestamp id
```