## Nano64 — 64‑bit Time‑Sortable Identifiers for TypeScript

**Nano64** is a lightweight library for generating time-sortable, globally unique IDs that offer the same practical guarantees as ULID or UUID in half the storage footprint; reducing index and I/O overhead while preserving cryptographic-grade randomness.  Incluedes optional monotonic sequencing and AES-GCM encryption.

[![GitHub Repo stars](https://img.shields.io/github/stars/only-cliches/nano64)](https://github.com/only-cliches/nano64)
[![NPM Version](https://img.shields.io/npm/v/nano64)](https://www.npmjs.com/package/nano64)
[![JSR Version](https://img.shields.io/jsr/v/%40onlycliches/nano64)](https://jsr.io/@onlycliches/nano64)
[![npm package minimized gzipped size](https://badgen.net/bundlephobia/minzip/nano64)](https://bundlephobia.com/package/nano64@latest)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

* **Time‑sortable:** IDs order by creation time automatically.
* **Compact:** 8 bytes / 16 hex characters.
* **Deterministic format:** `[63‥20]=timestamp`, `[19‥0]=random`.
* **Collision‑resistant:** ~1% colllision risk at 145,000 IDs per second.
* **Cross‑database‑safe:** Big‑endian bytes preserve order in SQLite, Postgres, MySQL, etc.
* **AES-GCM encryption:** Optional encryption masks the embedded creation date.
* **Unsigned canonical form:** Single, portable representation (0..2⁶⁴‑1).
* **Typed and test‑covered:** 100% TypeScript + Vitest.

---

## Installation

```bash
npm install nano64
```

---

## Usage

### Basic ID generation

```ts
import { Nano64 } from "nano64";

const id = Nano64.generate();
console.log(id.toHex());        // 17‑char uppercase hex TIMESTAMP-RANDOM
// 199C01B6659-5861C
console.log(id.toBytes());      // Uint8Array(8) 
// [25,156,1,182,101,149,134,28]
console.log(id.getTimestamp()); // ms since epoch
// 1759864645209
```

### Monotonic generation

Ensures strictly increasing values even if created in the same millisecond.

```ts
const a = Nano64.generateMonotonic();
const b = Nano64.generateMonotonic();
console.log(Nano64.compare(a, b)); // -1
```

### AES‑GCM encryption

IDs can easily be encrypted and decrypted to mask their timestamp value from public view.

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

### Database primary key storage

Store `id.toBytes()` as an **8‑byte big‑endian binary** value:

| DBMS        | Column Type       | Preserves Order | Notes                                                                  |
| ----------- | ----------------- | --------------- | ---------------------------------------------------------------------- |
| SQLite      | `BLOB` (8 bytes)  | ✅              | Lexicographic byte order matches unsigned big-endian.                  |
| PostgreSQL  | `BYTEA` (8 bytes) | ✅              | `PRIMARY KEY` on `BYTEA` is fine.                                      |
| MySQL 8+    | `BINARY(8)`       | ✅              | Binary collation.                                                      |
| MariaDB     | `BINARY(8)`       | ✅              | Same as MySQL.                                                         |
| SQL Server  | `BINARY(8)`       | ✅              | Clustered index sorts by bytes.                                        |
| Oracle      | `RAW(8)`          | ✅              | RAW compares bytewise.                                                 |
| CockroachDB | `BYTES` (8)       | ✅              | Bytewise ordering.                                                     |
| DuckDB      | `BLOB` (8)        | ✅              | Bytewise ordering.                                                     |

---

## Comparison with other identifiers

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

| Bits | Field          | Purpose             | Range                 |
| ---- | -------------- | ------------------- | --------------------- |
| 44   | Timestamp (ms) | Chronological order | 1970–2527             |
| 20   | Random         | Collision avoidance | 1,048,576 patterns/ms |

Collision characteristics:

* Theoretical: ~1% collision probability at 145 IDs/millisecond
* Real-world sustained rate (145k IDs/sec): <0.05% collision rate
* High-speed burst (3.4M IDs/sec): ~0.18% collision rate
* Concurrent generation (10.6M IDs/sec): ~0.58% collision rate

[Data Source](https://github.com/Codycody31/go-nano64)

---

## Tests

Run:

```bash
npm test
```

All unit tests are written in Vitest. They cover:

* Hex ↔ bytes conversions
* BigInt encoding
* Timestamp extraction and monotonic logic
* AES‑GCM encryption/decryption integrity
* Overflow edge cases

---

## Unoffical Ports

* [Go](https://github.com/Codycody31/go-nano64)

---

## License

MIT License

---

## Keywords

```
nano64, ulid, time-sortable, 64-bit id, bigint, aes-gcm, uid, uuid alternative, distributed id, database key, monotonic id, sortable id, crypto id, typescript, nodejs, browser, timestamp id
```
