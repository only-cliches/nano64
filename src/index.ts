/*
| 44-bit Field                | 20-bit Field | Description                   | Conflict Safety¹          |
|-----------------------------|--------------|-------------------------------|---------------------------|
| UNIX Epoch (milliseconds)   | Random       | High precision, time-sortable | ~145 IDs **per ms**       |
|
| ¹Collision probability reaches ~1% after generating ~145 IDs within the same millisecond.
| The 20 random bits provide 2^20 = 1,048,576 unique combinations per millisecond.
|
| Timestamp field is **44 bits**, providing a ~557-year range from the UNIX epoch (1970-01-01 to ~2527).
| Layout: [63‥20] Timestamp (ms) • [19‥0] Random
|
| Canonical representation: **unsigned 64-bit** integer (BigInt).
| Wire format: 8-byte big-endian unsigned integer.
| String format: 16-character uppercase hex string (e.g., "18B9E080D2D-54321").
*/

/**
 * @private Node CJS interop for ESM builds that may need to dynamically `require('node:crypto')`.
 */
declare const require: any;

// --- Constants for ID Structure ---

/** Number of bits allocated to the millisecond timestamp. (44 bits) */
export const TIMESTAMP_BITS = 44n as const;

/** Number of bits allocated to the random data. (20 bits) */
export const RANDOM_BITS = 20n as const;

/** Mask to extract the 44-bit timestamp from a Nano64 ID. */
const TIMESTAMP_MASK = (1n << TIMESTAMP_BITS) - 1n;

// --- Constants for 64-bit Arithmetic ---

/** The total number of bits in a Nano64 ID. */
const TOTAL_BITS = 64n;

/** Mask to ensure all values fit within an unsigned 64-bit integer range (0 to 2^64 - 1). */
const MASK64 = (1n << TOTAL_BITS) - 1n;

// --- Type Definitions ---

/**
 * A function that returns a random unsigned integer containing a specified number of random bits.
 * @param bits The number of random bits to generate (must be between 1 and 32).
 * @returns A number containing the random bits.
 */
export type RNG = (bits: number) => number;

/**
 * A function that returns the current time as UNIX epoch milliseconds.
 * Useful for dependency injection and testing.
 */
export type Clock = () => number;

// --- Internal Helper Functions ---

/**
 * @private Computes the inclusive u64 bounds for a given millisecond timestamp range.
 * This is a utility for creating database range queries.
 * @param tsStart The starting timestamp in milliseconds (inclusive).
 * @param tsEnd The ending timestamp in milliseconds (inclusive).
 * @returns An object with `lo` and `hi` bigint values representing the full range of possible Nano64 IDs.
 */
function rangeU64(tsStart: number, tsEnd: number): { lo: bigint; hi: bigint } {
    if (tsStart < 0 || tsEnd < 0) throw new Error("Timestamps must be non-negative.");
    if (tsStart > tsEnd) throw new Error("tsStart must be less than or equal to tsEnd.");

    const maxTs = Number(TIMESTAMP_MASK);
    if (tsStart > maxTs || tsEnd > maxTs) throw new Error(`Timestamp exceeds the ${Number(TIMESTAMP_BITS)}-bit range.`);

    const RAND_MAX = (1n << RANDOM_BITS) - 1n;
    const lo = (BigInt(tsStart) << RANDOM_BITS);      // Start of the range has random bits set to 0.
    const hi = (BigInt(tsEnd) << RANDOM_BITS) | RAND_MAX; // End of the range has random bits set to 1.
    return { lo: lo & MASK64, hi: hi & MASK64 };
}


/**
 * A **non-secure** random number generator that uses `Math.random()`.
 *
 * ⚠️ **Warning:** The output of this function is predictable and is **not cryptographically secure**.
 * Do not use this in production for any security-sensitive applications. It is intended for
 * testing, development, or performance benchmarking purposes only.
 *
 * @param bits The number of random bits to generate (must be between 1 and 32).
 * @returns A number containing the requested number of random bits.
 */
export const veryUnsafeRNG: RNG = (bits: number): number => {
    if (bits <= 0 || bits > 32) {
        throw new Error("RNG bits must be between 1 and 32.");
    }

    // Math.random() produces a float in the range [0, 1).
    // We scale it by 2^bits to get a float in the range [0, 2^bits).
    const max = Math.pow(2, bits);

    // Math.floor() converts the float to an integer, resulting in an
    // integer from 0 to (2^bits - 1), which is exactly the range we need.
    return Math.floor(Math.random() * max);
};

/**
 * @private Default cryptographically-secure RNG using the Web Crypto API.
 * @throws If `bits` is outside the 1-32 range or the Web Crypto API is unavailable.
 */
const defaultRNG: RNG = (bits: number): number => {
    if (bits <= 0 || bits > 32) throw new Error("RNG bits must be between 1 and 32.");
    const buf = new Uint32Array(1);
    const cryptoObj = (globalThis.crypto ?? awaitCrypto()); // Find a crypto implementation.
    cryptoObj.getRandomValues(buf);

    // If 32 bits are requested, we can return the full unsigned integer.
    if (bits === 32) return buf[0] >>> 0;

    // Otherwise, create a mask to extract the exact number of bits requested.
    const mask = (1 << bits) - 1;
    return buf[0] & mask;
};

/**
 * @private Dynamically resolves a Web Crypto implementation, primarily for Node.js environments.
 * In modern environments (browsers, Deno, Node 18+), `globalThis.crypto` is standard.
 * This function provides a fallback to `require('node:crypto').webcrypto` for older Node versions.
 * @returns A standards-compatible `Crypto` object.
 * @throws If no Web Crypto implementation can be found.
 */
function awaitCrypto(): Crypto {
    // Check for Node.js `require` function and attempt to load the 'node:crypto' module.
    if (typeof require !== "undefined") {
        try {
            const nodeCrypto = require("node:crypto");
            if (nodeCrypto.webcrypto) return nodeCrypto.webcrypto as Crypto;
        } catch {
            // Module not found, proceed to throw.
        }
    }
    throw new Error("A Web Crypto API implementation is required. Please use a modern browser or Node.js 18+.");
}


// --- Public Utility Namespaces ---

/**
 * Provides strict, spec-compliant hex encoding and decoding utilities.
 */
export const Hex: {
    /** Encodes a byte array into an uppercase hex string. */
    readonly fromBytes: (bytes: Uint8Array) => string;
    /** Decodes a hex string (with or without '0x' prefix) into a byte array. */
    readonly toBytes: (hex: string) => Uint8Array;
} = {
    fromBytes(bytes: Uint8Array): string {
        return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    },
    toBytes(hex: string): Uint8Array {
        const h = hex.startsWith("0x") ? hex.slice(2) : hex;
        if (h.length % 2 !== 0) throw new Error("Hex string must have an even number of characters.");
        if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error("Hex string contains non-hexadecimal characters.");

        const arr = new Uint8Array(h.length / 2);
        for (let i = 0; i < arr.length; i++) {
            arr[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
        }
        return arr;
    }
};

/**
 * Provides helper functions for converting between `bigint` and 8-byte big-endian `Uint8Array`.
 * All values are handled as **unsigned** 64-bit integers.
 */
export const BigIntHelpers: {
    /** Reads an 8-byte big-endian array into an unsigned 64-bit bigint. */
    readonly fromBytesBE: (bytes: Uint8Array) => bigint;
    /** Writes an unsigned 64-bit bigint into an 8-byte big-endian array. */
    readonly toBytesBE: (value: bigint) => Uint8Array;
} = {
    fromBytesBE(bytes: Uint8Array): bigint {
        if (bytes.length !== 8) throw new Error("Input must be exactly 8 bytes.");
        let value = 0n;
        for (const byte of bytes) {
            value = (value << 8n) | BigInt(byte);
        }
        return value; // Already unsigned due to construction.
    },
    toBytesBE(value: bigint): Uint8Array {
        if (value < 0n || value > MASK64) throw new Error("BigInt value is out of the unsigned 64-bit range.");
        const out = new Uint8Array(8);
        for (let i = 7; i >= 0; i--) {
            out[i] = Number(value & 0xFFn);
            value >>= 8n;
        }
        return out;
    }
};

/**
 * An authenticated, encrypted wrapper for a `Nano64` ID.
 * The payload is structured as: 12-byte IV || 8-byte ciphertext || 16-byte GCM tag. Total 36 bytes.
 */
export class EncryptedNano64 {
    constructor(
        /** The original, decrypted `Nano64` ID. */
        public readonly id: Nano64,
        /** The raw encrypted payload (IV, ciphertext, and GCM tag). */
        private readonly payload: Uint8Array,
        /** The AES-GCM key used for this operation. */
        public readonly key: CryptoKey
    ) {}

    /** Returns the 36-byte encrypted payload as a 72-character uppercase hex string. */
    toEncryptedHex(): string { return Hex.fromBytes(this.payload); }

    /** Returns a defensive copy of the 36-byte encrypted payload. */
    toEncryptedBytes(): Uint8Array { return this.payload.slice(); }
}

/**
 * A stateful generator that produces strictly increasing `Nano64` IDs.
 *
 * This class encapsulates the state required for monotonic generation, allowing multiple
 * independent generators to run in parallel without interfering with each other.
 */
export class MonotonicNano64Generator {

    private static readonly RANDOM_MASK = (1n << RANDOM_BITS) - 1n;

    constructor(
        /** Provide a minimum starting timestamp value. */
        private lastTimestamp = -1,
        /** Provide the starting value for the sequence generator */
        private lastRandom = -1n
    ) {

    }

    /**
     * Generates the next `Nano64` ID in the monotonic sequence.
     *
     * If called multiple times within the same millisecond, the random part is incremented.
     * If the random part overflows, the timestamp is advanced by 1 ms to ensure ordering.
     * This method is protected against system clock rollbacks.
     *
     * @param timestamp The UNIX epoch milliseconds to use. Defaults to `Date.now()`.
     * @param rng The random number generator, used only when the timestamp advances.
     * @returns A new, monotonically increasing `Nano64` instance.
     */
    next(timestamp: number = Date.now(), rng: RNG = defaultRNG): Nano64 {
        if (timestamp < 0) throw new Error("Timestamp cannot be negative.");
        if (timestamp >= 2 ** 44) throw new Error("Timestamp exceeds 44-bit range.");

        const t = Math.max(timestamp, this.lastTimestamp);

        let rand: bigint;
        if (t === this.lastTimestamp) {
            rand = (this.lastRandom + 1n) & MonotonicNano64Generator.RANDOM_MASK;
            if (rand === 0n) {
                const nextTimestamp = t + 1;
                this.lastTimestamp = nextTimestamp;
                this.lastRandom = 0n;
                const value = (BigInt(nextTimestamp) << RANDOM_BITS);
                return new Nano64(value);
            }
        } else {
            rand = BigInt(rng(Number(RANDOM_BITS)));
        }

        this.lastTimestamp = t;
        this.lastRandom = rand;

        const value = (BigInt(t) << RANDOM_BITS) | rand;
        return new Nano64(value);
    }
}

/**
 * A 64-bit, time-sortable unique identifier.
 *
 * It consists of a 44-bit timestamp (epoch milliseconds) and a 20-bit random field,
 * providing a balance of high resolution, sortability, and collision resistance.
 */
export class Nano64 {
    /**
     * Creates a new Nano64 instance from an unsigned 64-bit BigInt.
     * This constructor is intended for internal use; prefer the static factory methods.
     * @param _u The unsigned 64-bit integer value.
     */
    constructor(private readonly _u: bigint) {
        if (_u < 0n || _u > MASK64) {
            throw new Error("Nano64 value is out of the unsigned 64-bit range.");
        }
    }

    /** Returns the underlying unsigned 64-bit bigint value of the ID. */
    get value(): bigint { return this._u; }

    /**
     * Returns the ID as a 17-character, dash-separated hex string for readability.
     * Format: `TTTTTTTTTTT-RRRRR` (11 hex chars for timestamp, 5 for random).
     * @example "18B9E080D2D-54321"
     */
    toHex(): string {
        const full = this._u.toString(16).padStart(16, "0").toUpperCase();
        // The 44-bit timestamp occupies ceil(44/4) = 11 hex characters.
        const splitPoint = 11;
        return full.slice(0, splitPoint) + "-" + full.slice(splitPoint);
    }

    /** Returns the ID as an 8-byte, big-endian `Uint8Array`. */
    toBytes(): Uint8Array { return BigIntHelpers.toBytesBE(this._u); }

    /** Returns a JavaScript `Date` object from the embedded timestamp. */
    toDate(): Date { return new Date(this.getTimestamp()); }

    /**
     * Extracts and returns the UNIX epoch milliseconds from the ID.
     * @returns The timestamp as an integer.
     */
    getTimestamp(): number {
        return Number((this._u >> RANDOM_BITS) & TIMESTAMP_MASK);
    }

    /**
     * Generates the start and end byte arrays for a database query based on a timestamp range.
     *
     * @param tsStart The beginning of the time range in milliseconds (inclusive).
     * @param tsEnd The end of the time range in milliseconds (inclusive).
     * @returns An object containing `start` and `end` `Uint8Array`s for the query.
     */
    static timeRangeToBytes(tsStart: number, tsEnd: number): [Uint8Array, Uint8Array] {
        const { lo, hi } = rangeU64(tsStart, tsEnd);
        return [ BigIntHelpers.toBytesBE(lo), BigIntHelpers.toBytesBE(hi) ];
    }

    /**
     * Generates a new `Nano64` ID. 
     *
     * @param timestamp The UNIX epoch milliseconds to use. Defaults to `Date.now()`.
     * @param rng The random number generator to use. Defaults to a cryptographically secure one.
     * @returns A new `Nano64` instance.
     * @throws If the timestamp is negative or exceeds the 44-bit range.
     */
    static generate(timestamp: number = Date.now(), rng: RNG = defaultRNG): Nano64 {
        if (timestamp < 0) throw new Error("Timestamp cannot be negative.");
        if (timestamp >= 2 ** 44) throw new Error("Timestamp exceeds 44-bit range.");

        const ms = BigInt(timestamp);
        const rand = BigInt(rng(Number(RANDOM_BITS)));
        const value = (ms << RANDOM_BITS) | rand;
        return new Nano64(value);
    }

    /**
     * Create a new monotonic factory with it's own state.
     * 
     * @returns Monotonic Generator Factory
     */
    static monotonicFactory(startingTimeStamp = -1, startingRandomValue = -1n): MonotonicNano64Generator {
        return new MonotonicNano64Generator(startingTimeStamp, startingRandomValue);
    }

    /** Internal default monotonic factory */
    private static defaultMonoFact = new MonotonicNano64Generator();

    /**
     * Generates a new `Nano64` ID that is guaranteed to be monotonically increasing.
     * If called multiple times within the same millisecond, the random part is incremented.
     * If the random part overflows, the timestamp is advanced by 1 ms to ensure ordering.
     *
     * @param timestamp The UNIX epoch milliseconds to use. Defaults to `Date.now()`.
     * @param rng The random number generator, used only when the timestamp advances.
     * @returns A new, monotonically increasing `Nano64` instance.
     */
    static generateMonotonic(timestamp: number = Date.now(), rng: RNG = defaultRNG): Nano64 {
        return this.defaultMonoFact.next(timestamp, rng);
    }

    /**
     * Compares two `Nano64` IDs.
     * @returns `-1` if `a < b`, `0` if `a === b`, `1` if `a > b`.
     */
    static compare(a: Nano64, b: Nano64): -1 | 0 | 1 {
        if (a._u < b._u) return -1;
        if (a._u > b._u) return 1;
        return 0;
    }

    /** Checks if this `Nano64` ID is equal to another. */
    equals(other: Nano64): boolean {
        return this._u === other._u;
    }

    /** Creates a `Nano64` from any `bigint`. The value is masked to the u64 range. */
    static fromBigInt(v: bigint): Nano64 {
        return new Nano64(v & MASK64);
    }

    /**
     * Parses a `Nano64` from its hex string representation.
     * Accepts 16-char hex or 17-char dashed hex, with an optional "0x" prefix.
     * @throws If the hex string has an invalid length after cleaning.
     */
    static fromHex(hex: string): Nano64 {
        const clean = hex.replace("-", "").replace(/^0x/i, "");
        if (clean.length !== 16) throw new Error("Hex string must contain exactly 16 hexadecimal characters.");
        return new Nano64(BigInt("0x" + clean));
    }

    /** Creates a `Nano64` from an 8-byte, big-endian `Uint8Array`. */
    static fromBytes(bytes: Uint8Array): Nano64 {
        return new Nano64(BigIntHelpers.fromBytesBE(bytes));
    }

    /**
     * Creates a factory for encrypting and decrypting `Nano64` IDs using AES-GCM.
     *
     * @param aesGcmKey A `CryptoKey` suitable for AES-GCM. Must be 128, 192, or 256 bits.
     * @param clock A clock function, useful for testing. Defaults to `Date.now`.
     * @returns An object with methods for encryption and decryption.
     */
    static encryptedFactory(aesGcmKey: CryptoKey, clock: Clock = () => Date.now()): {
        /** Encrypts an existing Nano64 ID. */
        readonly encrypt: (id: Nano64) => Promise<EncryptedNano64>;
        /** Generates and encrypts a new Nano64 ID in one step. */
        readonly generateEncrypted: (ts?: number, rng?: RNG) => Promise<EncryptedNano64>;
        /** Decrypts a 36-byte payload. */
        readonly fromEncryptedBytes: (bytes: Uint8Array) => Promise<EncryptedNano64>;
        /** Decrypts a 72-character hex payload. */
        readonly fromEncryptedHex: (encHex: string) => Promise<EncryptedNano64>;
    } {
        const IV_LEN = 12; // 96 bits is recommended for AES-GCM.
        const PAYLOAD_LEN = IV_LEN + 8 + 16; // IV (12) + Ciphertext (8) + GCM Tag (16) = 36 bytes.

        /** @private Generates a fresh, random 96-bit IV for encryption. */
        function randomIV(): Uint8Array {
            const iv = new Uint8Array(IV_LEN);
            (globalThis.crypto ?? awaitCrypto()).getRandomValues(iv);
            return iv;
        }

        return {
            async encrypt(id: Nano64): Promise<EncryptedNano64> {
                const iv = new Uint8Array(randomIV());
                const plaintext = new Uint8Array(id.toBytes());
                const ciphertextAndTag = new Uint8Array(
                    await (globalThis.crypto ?? awaitCrypto()).subtle.encrypt(
                        { name: "AES-GCM", iv },
                        aesGcmKey,
                        plaintext
                    )
                );

                // Construct the final payload: [IV, Ciphertext, Tag]
                const payload = new Uint8Array(PAYLOAD_LEN);
                payload.set(iv, 0);
                payload.set(ciphertextAndTag, IV_LEN);

                return new EncryptedNano64(id, payload, aesGcmKey);
            },

            async generateEncrypted(ts: number = clock(), rng: RNG = defaultRNG): Promise<EncryptedNano64> {
                const id = Nano64.generate(ts, rng);
                return this.encrypt(id);
            },

            async fromEncryptedBytes(bytes: Uint8Array): Promise<EncryptedNano64> {
                if (bytes.length !== PAYLOAD_LEN) throw new Error(`Encrypted payload must be exactly ${PAYLOAD_LEN} bytes.`);
                
                // Deconstruct the payload: [IV, Ciphertext, Tag]
                const iv = new Uint8Array(bytes.subarray(0, IV_LEN));
                const ciphertextAndTag = new Uint8Array(bytes.subarray(IV_LEN));

                const plaintext = new Uint8Array(
                    await (globalThis.crypto ?? awaitCrypto()).subtle.decrypt(
                        { name: "AES-GCM", iv },
                        aesGcmKey,
                        ciphertextAndTag
                    )
                );
                
                if (plaintext.length !== 8) throw new Error("Decryption failed or yielded invalid data length.");
                
                const id = Nano64.fromBytes(plaintext);
                return new EncryptedNano64(id, bytes, aesGcmKey);
            },

            async fromEncryptedHex(encHex: string): Promise<EncryptedNano64> {
                const bytes = Hex.toBytes(encHex);
                return this.fromEncryptedBytes(bytes);
            }
        };
    }
}


/**
 * A utility class for converting `Nano64` IDs to and from signed 64-bit BigInts.
 *
 * This is particularly useful when storing Nano64 IDs in database columns that use
 * a signed 64-bit integer type, such as PostgreSQL's `BIGINT` and SQLite's `INTEGER`.
 *
 * The conversion method used (`value - 2^63`) ensures that the natural sort order
 * of the IDs is preserved, allowing for efficient, indexed range queries.
 */
export class SignedNano64 {
    /**
     * The sign bit for a 64-bit integer, equal to `2^63`.
     * This constant is used to flip the sign by offsetting the unsigned value.
     * @private
     */
    private static readonly SIGN_BIT = 1n << 63n;

    /**
     * Converts a `Nano64` object into a signed 64-bit BigInt.
     *
     * This is the format required for storing sortable IDs in a standard
     * signed `BIGINT` database column.
     *
     * @param id The `Nano64` instance to convert.
     * @returns A signed `bigint` that preserves the sort order of the original ID.
     */
    static fromId(id: Nano64): bigint {
        return id.value - this.SIGN_BIT;
    }

    /**
     * Creates a `Nano64` object from a signed 64-bit BigInt.
     *
     * This is used to reconstruct a `Nano64` object from a value retrieved
     * from a database.
     *
     * @param signedBigInt The signed `bigint` value from the database.
     * @returns A new `Nano64` instance.
     */
    static toId(signedBigInt: bigint): Nano64 {
        const unsignedValue = signedBigInt + this.SIGN_BIT;
        return Nano64.fromBigInt(unsignedValue);
    }

    /**
     * Generates the start and end signed BigInt values for a database query
     * based on a timestamp range.
     *
     * The returned values can be used directly in a SQL `BETWEEN` clause
     * on a signed integer column.
     *
     * @param tsStart The beginning of the time range in milliseconds (inclusive).
     * @param tsEnd The end of the time range in milliseconds (inclusive).
     * @returns An object containing `start` and `end` signed `bigint` values for the query.
     */
    static timeRangeToBigInts(tsStart: number, tsEnd: number): [bigint, bigint] {
        if (tsStart < 0 || tsEnd < 0) throw new Error("Timestamps must be non-negative.");
        if (tsStart > tsEnd) throw new Error("tsStart must be less than or equal to tsEnd.");

        // Perform the calculation using BigInts to avoid 32-bit truncation.
        const maxTs = Number((1n << TIMESTAMP_BITS) - 1n);
        
        if (tsStart > maxTs || tsEnd > maxTs) throw new Error(`Timestamp exceeds the ${Number(TIMESTAMP_BITS)}-bit range.`);
        
        const RAND_MAX = (1n << RANDOM_BITS) - 1n;
        const unsignedStart = (BigInt(tsStart) << RANDOM_BITS);
        const unsignedEnd = (BigInt(tsEnd) << RANDOM_BITS) | RAND_MAX;

        // Convert the unsigned bounds to signed bounds
        return [unsignedStart - this.SIGN_BIT, unsignedEnd - this.SIGN_BIT]
    }

    /**
     * Extracts the millisecond timestamp directly from a signed 64-bit BigInt.
     *
     * This is a performance-optimized method that avoids the overhead of creating
     * an intermediate `Nano64` object when you only need the timestamp. It combines
     * the conversion and extraction steps into a single operation.
     *
     * @param signedBigInt The signed 64-bit integer value, typically from a database.
     * @returns The UNIX epoch timestamp in milliseconds.
     */
    static getTimestamp(signedBigInt: bigint): number {
        // 1. Convert the signed value back to its original unsigned representation.
        const unsignedValue = signedBigInt + this.SIGN_BIT;

        // 2. Right-shift the unsigned value to discard the 20 random bits,
        //    moving the timestamp into the least significant position.
        const timestampBigInt = unsignedValue >> RANDOM_BITS;

        // 3. Convert the BigInt result to a standard number.
        //    Since the timestamp is only 44 bits, it will safely fit in a
        //    JavaScript number without loss of precision.
        return Number(timestampBigInt);
    }
}