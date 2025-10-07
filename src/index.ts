/*
| 44‑bit Field                | 20‑bit Field | Description                   | Conflict Safety¹          |
|-----------------------------|--------------|-------------------------------|---------------------------|
| UNIX Epoch (milliseconds)   | Random       | High precision, time‑sortable | 145 IDs **per ms**        |
|
| ¹Collision probability ≈ 1% once ~145 IDs are generated within a **single millisecond** (20 random bits -> 1,048,576 patterns per ms).
|
| Timestamp field is **44 bits** (~557 years from 1970‑01‑01 to ~2527). Layout:
|   [63‥20] milliseconds • [19‥0] random.
| Canonical representation: **unsigned 64‑bit** integer (0..2^64‑1).
| Wire format: 8‑byte big‑endian bytes; hex is 16 chars upper‑case.
*/

declare const require: any;

export const TIMESTAMP_BITS = 44n as const;
export const RANDOM_BITS = 20n as const;
const TIMESTAMP_SHIFT = RANDOM_BITS;                // 20
const TIMESTAMP_MASK = (1n << TIMESTAMP_BITS) - 1n; // 0..(2^44-1)

const U64 = 1n << 64n;
const MASK64 = U64 - 1n;

export type RNG = (bits: number) => number;
export type Clock = () => number; // ms since epoch

/** Default RNG using Web Crypto. */
const defaultRNG: RNG = (bits: number): number => {
    if (bits <= 0 || bits > 32) throw new Error("bits must be 1–32");
    const buf = new Uint32Array(1);
    const cryptoObj = (globalThis.crypto ?? (awaitCrypto()));
    cryptoObj.getRandomValues(buf);
    if (bits === 32) return buf[0] >>> 0;
    const mask = (2 ** bits) - 1; // avoid 32-bit op truncation
    return buf[0] & mask;
};

function awaitCrypto(): Crypto {
    // Node 18+ exposes globalThis.crypto. Fallback to node:crypto.webcrypto if present.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const c = (typeof require !== "undefined") ? require("node:crypto").webcrypto : undefined;
    if (!c) throw new Error("Web Crypto unavailable. Use Node 18+ or a browser with crypto");
    return c as Crypto;
}

/** Hex helpers with validation. */
export const Hex: {
    readonly fromBytes: (bytes: Uint8Array<ArrayBufferLike>) => string;
    readonly toBytes: (hex: string) => Uint8Array;
} = {
    fromBytes(bytes: Uint8Array): string {
        return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    },
    toBytes(hex: string): Uint8Array {
        const h = hex.startsWith("0x") ? hex.slice(2) : hex;
        if (h.length % 2 !== 0) throw new Error("hex length must be even");
        if (!/^([0-9a-fA-F]{2})+$/.test(h)) throw new Error("hex contains non-hex characters");
        const arr = new Uint8Array(h.length / 2);
        for (let i = 0; i < arr.length; ++i) arr[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
        return arr;
    }
} as const;

/** Big-endian ⇄ bigint conversions (fixed 8 bytes), **unsigned**. */
export const BigIntHelpers: {
    readonly fromBytesBE: (bytes: Uint8Array<ArrayBufferLike>) => bigint;
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

export class EncryptedNano64 {
    constructor(
        public readonly id: Nano64,
        private readonly payload: Uint8Array,  // IV ‖ cipher+tag
        public readonly key: CryptoKey
    ) { }

    /** 72‑char hex representation (default wire format). */
    toEncryptedHex(): string { return Hex.fromBytes(this.payload); }
    /** Raw bytes. */
    toEncryptedBytes(): Uint8Array { return this.payload.slice(); }
}

export class Nano64 {
    // Canonical representation: unsigned 64-bit (0..2^64-1)
    constructor(private readonly _u: bigint) {
        if (_u < 0n || _u > MASK64) throw new Error("Nano64 out of u64 range");
    }

    /** Unsigned 64-bit bigint value. */
    get value(): bigint { return this._u; }
    toHex(): string { return this._u.toString(16).padStart(16, "0").toUpperCase(); }
    toBytes(): Uint8Array { return BigIntHelpers.toBytesBE(this._u); }
    toDate(): Date { return new Date(this.getTimestamp()); }

    /** Unix‑epoch milliseconds extracted from the ID. */
    getTimestamp(): number {
        const ms = Number((this._u >> TIMESTAMP_SHIFT) & TIMESTAMP_MASK);
        return ms;
    }

    /** Generate IDs without monotonic guarantee. */
    static generate(timestamp: number = Date.now(), rng: RNG = defaultRNG): Nano64 {
        if (timestamp < 0) throw new Error("timestamp cannot be negative");
        if (timestamp >= Number(1n << TIMESTAMP_BITS)) throw new Error("timestamp exceeds 44‑bit range");
        const ms = BigInt(timestamp) & TIMESTAMP_MASK;
        const rand = BigInt(rng(Number(RANDOM_BITS)));
        const uVal = (ms << TIMESTAMP_SHIFT) | rand;
        return new Nano64(uVal);
    }

    private static lastTimestamp = -1;
    private static lastRandom = -1n;
    private static readonly RANDOM_MASK = (1n << RANDOM_BITS) - 1n;

    /** Monotonic generator. Bumps timestamp by 1 ms if per‑ms space is exhausted. */
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


    static compare(a: Nano64, b: Nano64): -1 | 0 | 1 {
        return a._u < b._u ? -1 : a._u > b._u ? 1 : 0;
    }
    equals(other: Nano64): boolean { return Nano64.compare(this, other) === 0; }

    static fromBigInt(v: bigint): Nano64 { return new Nano64(v & MASK64); }
    static fromHex(hex: string): Nano64 {
        const h = hex.startsWith("0x") ? hex.slice(2) : hex;
        if (h.length !== 16) throw new Error("hex must be 16 chars");
        const v = BigInt("0x" + h) & MASK64;
        return new Nano64(v);
    }
    static fromBytes(bytes: Uint8Array): Nano64 { return new Nano64(BigIntHelpers.fromBytesBE(bytes)); }

    /**
     * AES‑GCM binding. Payload: 12‑byte IV || 8‑byte ciphertext || 16‑byte tag = 36 bytes.
     */
    static encryptedId(aesGcmKey: CryptoKey, clock: Clock = () => Date.now()): {
        readonly encrypt: (id: Nano64) => Promise<EncryptedNano64>;
        readonly generateEncrypted: (ts?: number, rng?: RNG) => Promise<EncryptedNano64>;
        readonly fromEncryptedBytes: (bytes: Uint8Array) => Promise<EncryptedNano64>;
        readonly fromEncryptedHex: (encHex: string) => Promise<EncryptedNano64>;
    } {
        const IV_LEN = 12; // 96-bit
        function randomIV(): Uint8Array {
            const iv = new Uint8Array(IV_LEN);
            (globalThis.crypto ?? awaitCrypto()).getRandomValues(iv);
            return iv;
        }
        const PAYLOAD_LEN = IV_LEN + 8 + 16;      // 36 bytes total

        return {
            async encrypt(id: Nano64): Promise<EncryptedNano64> {
                const iv = new Uint8Array(randomIV());
                const plain = new Uint8Array(BigIntHelpers.toBytesBE(id.value));
                const cipher = new Uint8Array(await (globalThis.crypto ?? awaitCrypto()).subtle.encrypt({ name: "AES-GCM", iv }, aesGcmKey, plain));
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
                const plain = new Uint8Array(await (globalThis.crypto ?? awaitCrypto()).subtle.decrypt({ name: "AES-GCM", iv }, aesGcmKey, cipher));
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