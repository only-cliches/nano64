/*
| 44-bit Field                | 20-bit Field | Description                   | Conflict Safety¹          |
|-----------------------------|--------------|-------------------------------|---------------------------|
| UNIX Epoch (milliseconds)   | Random       | High precision, time-sortable | 145 IDs **per ms**        |
|
| ¹Collision probability ≈ 1% once ~145 IDs are generated within a **single millisecond** (20 random bits -> 1,048,576 patterns per ms).
|
| Timestamp field is **44 bits** (~557 years from 1970-01-01 to ~2527). Layout:
|   [63‥20] milliseconds • [19‥0] random.
| Canonical representation: **unsigned 64-bit** integer (0..2^64-1).
| Wire format: 8-byte big-endian bytes; hex is 16 chars upper-case.
*/

/** Node CJS interop for ESM builds that reference `node:crypto`. */
declare const require: any;

/** Number of bits allocated to the millisecond timestamp (0..2^44-1). */
export const TIMESTAMP_BITS = 44n as const;

/** Number of bits allocated to the random field per millisecond (0..2^20-1). */
export const RANDOM_BITS = 20n as const;

/** Bit shift used to position the timestamp above the random field. */
const TIMESTAMP_SHIFT = RANDOM_BITS;

/** Mask for extracting the 44-bit timestamp from a u64 value. */
const TIMESTAMP_MASK = (1n << TIMESTAMP_BITS) - 1n;

/** 2^64, used for u64 bounds and masking. */
const U64 = 1n << 64n;

/** Mask for constraining values to the u64 range (0..2^64-1). */
const MASK64 = U64 - 1n;

/** Function type for entropy source that returns `bits` random bits (1..32). */
export type RNG = (bits: number) => number;

/** Function type for a clock that returns epoch milliseconds. */
export type Clock = () => number;

/**
 * Default cryptographically-secure RNG using Web Crypto.
 * Returns an unsigned integer with exactly `bits` bits of entropy.
 * @throws if `bits` is outside 1..32 or Web Crypto is unavailable.
 */
const defaultRNG: RNG = (bits: number): number => {
    if (bits <= 0 || bits > 32) throw new Error("bits must be 1–32");
    const buf = new Uint32Array(1);
    const cryptoObj = (globalThis.crypto ?? (awaitCrypto()));
    cryptoObj.getRandomValues(buf);
    if (bits === 32) return buf[0] >>> 0;
    const mask = (2 ** bits) - 1; // avoid 32-bit op truncation
    return buf[0] & mask;
};

/**
 * Resolve a Web Crypto implementation in Node when `globalThis.crypto` is missing.
 * @returns a standards-compatible `Crypto` object.
 * @throws if no Web Crypto is available (Node <18 without polyfill).
 */
function awaitCrypto(): Crypto {
    // Node 18+ exposes globalThis.crypto. Fallback to node:crypto.webcrypto if present.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const c = (typeof require !== "undefined") ? require("node:crypto").webcrypto : undefined;
    if (!c) throw new Error("Web Crypto unavailable. Use Node 18+ or a browser with crypto");
    return c as Crypto;
}

/**
 * Hex encoding/decoding helpers with strict validation.
 * - `fromBytes` → uppercase hex string.
 * - `toBytes`   → Uint8Array, accepts optional `0x` prefix.
 */
export const Hex: {
    readonly fromBytes: (bytes: Uint8Array<ArrayBufferLike>) => string;
    readonly toBytes: (hex: string) => Uint8Array;
} = {
    /** Convert bytes to uppercase hex string. */
    fromBytes(bytes: Uint8Array): string {
        return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    },
    /**
     * Parse hex string into bytes.
     * @throws if length is odd or non-hex chars are present.
     */
    toBytes(hex: string): Uint8Array {
        const h = hex.startsWith("0x") ? hex.slice(2) : hex;
        if (h.length % 2 !== 0) throw new Error("hex length must be even");
        if (!/^([0-9a-fA-F]{2})+$/.test(h)) throw new Error("hex contains non-hex characters");
        const arr = new Uint8Array(h.length / 2);
        for (let i = 0; i < arr.length; ++i) arr[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
        return arr;
    }
} as const;

/**
 * Big-endian ⇄ bigint conversions for fixed 8-byte **unsigned** integers.
 * All values are constrained to the u64 range.
 */
export const BigIntHelpers: {
    /** Read a u64 from 8 big-endian bytes. */
    readonly fromBytesBE: (bytes: Uint8Array<ArrayBufferLike>) => bigint;
    /** Write a u64 to 8 big-endian bytes. */
    readonly toBytesBE: (value: bigint) => Uint8Array;
} = {
    fromBytesBE(bytes: Uint8Array): bigint {
        if (bytes.length !== 8) throw new Error("must be 8 bytes");
        let v = 0n;
        for (const b of bytes) v = (v << 8n) | BigInt(b);
        return v & MASK64; // unsigned
    },
    toBytesBE(value: bigint): Uint8Array {
        if (value < 0n || value > MASK64) throw new Error("value out of u64 range");
        let v = value & MASK64;
        const out = new Uint8Array(8);
        for (let i = 7; i >= 0; --i) { out[i] = Number(v & 0xFFn); v >>= 8n; }
        return out;
    }
} as const;

/**
 * Authenticated encrypted wrapper for a `Nano64` ID.
 * Payload layout: 12-byte IV || 8-byte ciphertext || 16-byte GCM tag (36 bytes).
 */
export class EncryptedNano64 {
    constructor(
        /** The decrypted original `Nano64` ID. */
        public readonly id: Nano64,
        /** The raw encrypted payload (IV ‖ cipher+tag). */
        private readonly payload: Uint8Array,
        /** The AES-GCM key used for encryption/decryption. */
        public readonly key: CryptoKey
    ) { }

    /** Return the 36-byte payload as 72-char uppercase hex. */
    toEncryptedHex(): string { return Hex.fromBytes(this.payload); }
    /** Return a defensive copy of the raw payload bytes. */
    toEncryptedBytes(): Uint8Array { return this.payload.slice(); }
}

/**
 * 64-bit time-sortable identifier with 44-bit timestamp and 20-bit random field.
 * Canonical representation is an **unsigned** 64-bit bigint (0..2^64-1).
 */
export class Nano64 {
    // Canonical representation: unsigned 64-bit (0..2^64-1)
    constructor(private readonly _u: bigint) {
        if (_u < 0n || _u > MASK64) throw new Error("Nano64 out of u64 range");
    }

    /** Unsigned 64-bit bigint value. */
    get value(): bigint { return this._u; }

    /** Uppercase 16-char hex encoding of the u64, with a dash between timestamp and random parts. */
    toHex(): string {
        const full = this._u.toString(16).padStart(16, "0").toUpperCase();
        // Split 44-bit (11 hex digits) timestamp + 20-bit (5 hex digits) random = 16 hex total
        const split = 11; // ceil(44 / 4)
        return full.slice(0, split) + "-" + full.slice(split);
    }

    /** 8-byte big-endian encoding of the u64. */
    toBytes(): Uint8Array { return BigIntHelpers.toBytesBE(this._u); }

    /** Convenience: build a JS `Date` from the embedded timestamp. */
    toDate(): Date { return new Date(this.getTimestamp()); }

    /**
     * Extract the embedded UNIX-epoch milliseconds from the ID.
     * @returns integer milliseconds in range [0, 2^44-1].
     */
    getTimestamp(): number {
        const ms = Number((this._u >> TIMESTAMP_SHIFT) & TIMESTAMP_MASK);
        return ms;
    }

    /**
     * Generate an ID with a given or current timestamp.
     * Random field is filled with `rng(20)` bits of entropy.
     * @throws if timestamp is negative or exceeds 44-bit range.
     */
    static generate(timestamp: number = Date.now(), rng: RNG = defaultRNG): Nano64 {
        if (timestamp < 0) throw new Error("timestamp cannot be negative");
        if (timestamp >= Number(1n << TIMESTAMP_BITS)) throw new Error("timestamp exceeds 44-bit range");
        const ms = BigInt(timestamp) & TIMESTAMP_MASK;
        const rand = BigInt(rng(Number(RANDOM_BITS)));
        const uVal = (ms << TIMESTAMP_SHIFT) | rand;
        return new Nano64(uVal);
    }

    /** Last timestamp used by `generateMonotonic`. */
    private static lastTimestamp = -1;

    /** Last random field used by `generateMonotonic`. */
    private static lastRandom = -1n;

    /** Mask for the 20-bit random field. */
    private static readonly RANDOM_MASK = (1n << RANDOM_BITS) - 1n;

    /**
     * Monotonic generator. Nondecreasing across calls in one process.
     * If the per-ms sequence wraps, the timestamp is bumped by 1 ms and the random field resets to 0.
     * @throws if timestamp is negative or exceeds 44-bit range.
     */
    static generateMonotonic(timestamp: number = Date.now(), rng: RNG = defaultRNG): Nano64 {
        if (timestamp < 0) throw new Error("timestamp cannot be negative");
        if (timestamp >= Number(1n << TIMESTAMP_BITS)) throw new Error("timestamp exceeds 44-bit range");

        // Enforce nondecreasing time
        const t = Math.max(timestamp, this.lastTimestamp);

        let rand: bigint;
        if (t === this.lastTimestamp) {
            // same ms → increment
            rand = (this.lastRandom + 1n) & this.RANDOM_MASK;
            if (rand === 0n) {
                // per-ms space exhausted → move to next ms and start at 0
                const t2 = t + 1;
                this.lastTimestamp = t2;
                this.lastRandom = 0n;
                const ms2 = BigInt(t2) & TIMESTAMP_MASK;
                const u2 = (ms2 << TIMESTAMP_SHIFT) | 0n;
                return new Nano64(u2);
            }
        } else {
            // first ID in this newer ms
            rand = BigInt(rng(Number(RANDOM_BITS)));
        }

        this.lastTimestamp = t;
        this.lastRandom = rand;

        const ms = BigInt(t) & TIMESTAMP_MASK;
        const uVal = (ms << TIMESTAMP_SHIFT) | rand;
        return new Nano64(uVal);
    }

    /**
     * Compare two IDs as unsigned 64-bit numbers.
     * @returns -1, 0, or 1.
     */
    static compare(a: Nano64, b: Nano64): -1 | 0 | 1 {
        return a._u < b._u ? -1 : a._u > b._u ? 1 : 0;
    }

    /** Equality check by unsigned value. */
    equals(other: Nano64): boolean { return Nano64.compare(this, other) === 0; }

    /** Construct from any bigint; value will be masked to u64. */
    static fromBigInt(v: bigint): Nano64 { return new Nano64(v & MASK64); }

    /**
     * Parse from 17-char dashed hex (timestamp-random) or plain 16-char hex. (uppercase or lowercase, optional `0x`).
     * @throws if length is not 16.
     */
    static fromHex(hex: string): Nano64 {
        const clean = hex.replace("-", "").replace(/^0x/, "");
        if (clean.length !== 16) throw new Error("hex must be 16 chars after removing dash");
        const v = BigInt("0x" + clean) & MASK64;
        return new Nano64(v);
    }

    /** Parse from 8 big-endian bytes. */
    static fromBytes(bytes: Uint8Array): Nano64 { return new Nano64(BigIntHelpers.fromBytesBE(bytes)); }

    /**
     * Bind an AES-GCM key to encrypt/decrypt Nano64 IDs.
     * Payload: 12-byte random IV || 8-byte ciphertext || 16-byte tag (36 bytes total).
     * IV is random to avoid timestamp leakage and IV reuse hazards.
     */
    static encryptedFactory(aesGcmKey: CryptoKey, clock: Clock = () => Date.now()): {
        /** Encrypt an existing Nano64 into an authenticated payload. */
        readonly encrypt: (id: Nano64) => Promise<EncryptedNano64>;
        /** Generate a new Nano64, then encrypt it. */
        readonly generateEncrypted: (ts?: number, rng?: RNG) => Promise<EncryptedNano64>;
        /** Decrypt from raw 36-byte payload. */
        readonly fromEncryptedBytes: (bytes: Uint8Array) => Promise<EncryptedNano64>;
        /** Decrypt from 72-char hex payload. */
        readonly fromEncryptedHex: (encHex: string) => Promise<EncryptedNano64>;
    } {
        const IV_LEN = 12; // 96-bit

        /** Generate a fresh 96-bit random IV. */
        function randomIV(): Uint8Array {
            const iv = new Uint8Array(IV_LEN);
            (globalThis.crypto ?? awaitCrypto()).getRandomValues(iv);
            return iv;
        }

        const PAYLOAD_LEN = IV_LEN + 8 + 16; // 36 bytes total

        return {
            async encrypt(id: Nano64): Promise<EncryptedNano64> {
                const iv = new Uint8Array(randomIV());
                const plain = new Uint8Array(BigIntHelpers.toBytesBE(id.value));
                const cipher = new Uint8Array(
                    await (globalThis.crypto ?? awaitCrypto()).subtle.encrypt({ name: "AES-GCM", iv }, aesGcmKey, plain)
                );
                if (cipher.length !== 8 + 16) throw new Error("unexpected AES-GCM output length");
                const out = new Uint8Array(PAYLOAD_LEN);
                out.set(iv, 0); out.set(cipher, IV_LEN);
                return new EncryptedNano64(id, out, aesGcmKey);
            },

            async generateEncrypted(ts: number = clock(), rng: RNG = defaultRNG): Promise<EncryptedNano64> {
                return this.encrypt(Nano64.generate(ts, rng));
            },

            async fromEncryptedBytes(bytes: Uint8Array): Promise<EncryptedNano64> {
                if (bytes.length !== PAYLOAD_LEN) throw new Error("encrypted payload must be 36 bytes");
                const iv = new Uint8Array(bytes.subarray(0, IV_LEN));
                const cipher = new Uint8Array(bytes.subarray(IV_LEN));
                const plain = new Uint8Array(
                    await (globalThis.crypto ?? awaitCrypto()).subtle.decrypt({ name: "AES-GCM", iv }, aesGcmKey, cipher)
                );
                if (plain.length !== 8) throw new Error("decryption yielded invalid length");
                const id = Nano64.fromBytes(plain);
                return new EncryptedNano64(id, bytes, aesGcmKey);
            },

            async fromEncryptedHex(encHex: string): Promise<EncryptedNano64> {
                const bytes = Hex.toBytes(encHex);
                if (bytes.length !== PAYLOAD_LEN) throw new Error("encrypted payload must be 36 bytes");
                return this.fromEncryptedBytes(bytes);
            }
        } as const;
    }
}
