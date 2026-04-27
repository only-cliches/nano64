# Change Log

## 1.4.0 April 27, 2026
- BREAKING: `EncryptedNano64` no longer exposes or stores the AES-GCM `CryptoKey`; encrypted wrapper objects now only carry the decrypted ID and encrypted payload.
- BREAKING: `Nano64.fromUnsignedBigInt()` now rejects values outside the unsigned 64-bit range instead of masking them into range.
- BREAKING: Custom RNG output is now validated and must be an integer within the 20-bit random field.
- Hardened encrypted payload handling with length validation and defensive byte copies to keep decrypted IDs and payload bytes consistent.
- Tightened timestamp/range validation, signed 64-bit conversion bounds, monotonic overflow handling, and dashed hex parsing.
- Cached Web Crypto resolution and reused the default RNG scratch buffer to reduce per-ID overhead.
- Reduced npm package contents with an explicit `files` allowlist, added `exports`, marked the package side-effect-free, and added a `prepack` build.
- Removed undeclared `npx terser` package scripts.
- Updated documentation to clarify collision/security boundaries and avoid overclaiming UUID/ULID-equivalent guarantees.
- Upgraded Vitest and refreshed the lockfile to clear audited dev-tool vulnerabilities.
- Added regression tests for strict parsing, invalid RNG output, encrypted payload immutability, monotonic overflow, non-integer ranges, and signed integer bounds.

## 1.3.1 Oct 10, 2025
BREAKING: Changed `fromBigInt` to `fromUnsignedBigInt` to avoid confusion with the `SignedNano64` methods.
Added README and doc comments to reduce likelyhood of unsigned/signed misuse.

## 1.3.0 Oct 9, 2025
BREAKING: `timeRangeToBytes` now returns a tuple instead of an object.
README fixes.
Created class `MonotonicNano64Generator` for generating monotonic Ids.
Created class `SignedNano64` for interacting with signed integer database column types.
Added README for signed integer usage in databases.

## 1.2.0 Oct 8, 2025
Implemented new `timeRangeToBytes` function designed to assist with database range queries.
Added SQLite based tests and standard tests for new range query feature.
Added SQLite examples to readme for range query feature.
Added tests
Updated code comments

## 1.1.3 Oct 7, 2025
Added Go port to README.md
BREAKING: Updated `encryptedId` to be `encryptedFactory`, copying the API tweak from the go port.

## 1.1.2 Oct 7, 2025
Added dash in hex enconding.

## 1.1.1 Oct 7, 2025
Improved code docs.

## 1.1.0 Oct 7, 2025
AES Encryption was using timestamp for the IV value, exposing the time the encryption occured (and potentially the internal key value).  IV is now random.

## 1.0.5 Oct 7, 2025
Initial release
