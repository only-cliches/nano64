## Nano64 — 64‑bit Time‑Sortable Identifiers for TypeScript

**Nano64** is a lightweight library (2kb gzipped) for generating compact 64‑bit identifiers that encode a 44‑bit millisecond timestamp and 20‑bit random field. Each ID fits in 8 bytes, sorts chronologically, and can be safely encrypted with AES‑GCM.

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
* **Collision‑resistant:** ~1% risk only if >145 IDs/ms.
* **Cross‑database‑safe:** Big‑endian bytes preserve order in SQLite, Postgres, MySQL, etc.
* **AES-GCM encryption:** 36-byte authenticated payloads.
* **Privacy option:** Encryption masks the embedded creation date while preserving sort order.
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
console.log(id.toHex());        // 16‑char uppercase hex
console.log(id.toBytes());      // Uint8Array(8)
console.log(id.getTimestamp()); // ms since epoch
```

### Monotonic generation

Ensures strictly increasing values even if created in the same millisecond.

```ts
const a = Nano64.generateMonotonic();
const b = Nano64.generateMonotonic();
console.log(Nano64.compare(a, b)); // -1
```

### AES‑GCM encryption

Keys can easily be encrypted and decrypted to mask their timestamp value from public view.

```ts
const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
const enc = Nano64.encryptedId(key);

// Generate and encrypt
const wrapped = await enc.generateEncrypted();
console.log(wrapped.toEncryptedHex()); // 72‑char hex payload

// Decrypt later
const restored = await enc.fromEncryptedHex(wrapped.toEncryptedHex());
console.log(restored.id.value === wrapped.id.value); // true
```

### Database storage

Store `id.toBytes()` as an **8‑byte big‑endian binary** value:

| DBMS       | Column Type | Preserves Order | Notes                     |
| ---------- | ----------- | --------------- | ------------------------- |
| SQLite     | `BLOB(8)`   | ✅               | Lexicographic order works |
| PostgreSQL | `BYTEA(8)`  | ✅               | Use binary comparison     |
| MySQL      | `BINARY(8)` | ✅               | Default binary collation  |

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

### `Nano64.encryptedId(key, clock?)`

Returns an object with `encrypt`, `generateEncrypted`, `fromEncryptedBytes`, and `fromEncryptedHex`.

---

## Design

| Bits | Field          | Purpose             | Range                 |
| ---- | -------------- | ------------------- | --------------------- |
| 44   | Timestamp (ms) | Chronological order | 1970–2527             |
| 20   | Random         | Collision avoidance | 1,048,576 patterns/ms |

Collision probability ≈ 1% if ~145 IDs generated in one millisecond.

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

## License

MIT License

---

## Keywords

```
nano64, ulid, time-sortable, 64-bit id, bigint, aes-gcm, uid, uuid alternative, distributed id, database key, monotonic id, sortable id, crypto id, typescript, nodejs, browser, timestamp id
```
