import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Nano64, Hex, BigIntHelpers, TIMESTAMP_BITS, RANDOM_BITS } from "../src/index";
import Database from "better-sqlite3";

const U64 = 1n << 64n;
const MASK64 = U64 - 1n;

describe("Hex helpers", () => {
    it("round-trips bytes", () => {
        const b = new Uint8Array([0, 1, 2, 0xAA, 0xFF]);
        const h = Hex.fromBytes(b);
        expect(h).toBe("000102AAFF");
        expect(Hex.toBytes(h)).toEqual(b);
    });
    it("rejects bad hex", () => {
        expect(() => Hex.toBytes("GG")).toThrow();
        expect(() => Hex.toBytes("0x123")).toThrow();
    });
});

describe("BigIntBE (unsigned)", () => {
    it("encodes and decodes u64 values", () => {
        const vals = [0n, 1n, MASK64, (1n << 63n) - 1n, 1n << 63n];
        for (const v of vals) {
            const b = BigIntHelpers.toBytesBE(v);
            expect(b.length).toBe(8);
            const r = BigIntHelpers.fromBytesBE(b);
            expect(r).toBe(v & MASK64);
        }
    });
});

describe("Nano64 core", () => {
    it("hex/bytes round-trip", () => {
        const id = Nano64.generate(1234567890);
        const hex = id.toHex();
        expect(hex).toHaveLength(17);
        const b = id.toBytes();
        const fromHex = Nano64.fromHex(hex);
        const fromBytes = Nano64.fromBytes(b);
        expect(fromHex.value).toBe(id.value);
        expect(fromBytes.value).toBe(id.value);
    });

    // New test for hex parsing flexibility
    it("parses various hex formats", () => {
        const id = Nano64.generate(Date.now());
        const dashed = id.toHex();
        const plain = dashed.replace("-", "");

        expect(Nano64.fromHex(dashed).value).toBe(id.value);
        expect(Nano64.fromHex(plain).value).toBe(id.value);
        expect(Nano64.fromHex(plain.toLowerCase()).value).toBe(id.value);
        expect(Nano64.fromHex("0x" + plain).value).toBe(id.value);
        expect(Nano64.fromHex("0X" + plain.toLowerCase()).value).toBe(id.value);
    });

    it("extracts timestamp", () => {
        const ts = 2_000_000_000; // within 44-bit range
        const id = Nano64.generate(ts, () => 0);
        expect(id.getTimestamp()).toBe(ts);
        expect(id.toDate()).toEqual(new Date(ts));
    });

    it("rejects out-of-range timestamp", () => {
        const limit = 2 ** Number(TIMESTAMP_BITS);
        expect(() => Nano64.generate(limit)).toThrow();
        expect(() => Nano64.generate(-1)).toThrow();
    });

    it("compares and checks equality correctly", () => {
        const a = Nano64.generate(1000);
        const b = Nano64.fromBigInt(a.value); // Exact copy
        const c = Nano64.generate(2000);

        expect(a.equals(b)).toBe(true);
        expect(a.equals(c)).toBe(false);
        expect(Nano64.compare(a, b)).toBe(0);
        expect(Nano64.compare(a, c)).toBe(-1);
        expect(Nano64.compare(c, a)).toBe(1);
    });
});

describe("Nano64 monotonic generation", () => {
    it("increments in same ms", () => {
        const ts = 5_000_000_000;
        const a = Nano64.generateMonotonic(ts, () => 0);
        const b = Nano64.generateMonotonic(ts, () => 0);
        expect(Nano64.compare(a, b)).toBe(-1);
        expect(a.getTimestamp()).toBe(ts);
        expect(b.getTimestamp()).toBe(ts);
        expect(b.value).toBe(a.value + 1n);
    });

    it("bumps timestamp on overflow", () => {
        const ts = 7_000_000_000;
        const RAND_MAX = (1n << RANDOM_BITS) - 1n;

        // Manually create an ID that is on the verge of overflowing its random bits.
        const id_before_overflow = Nano64.fromBigInt((BigInt(ts) << RANDOM_BITS) | (RAND_MAX - 1n));
        Nano64.generateMonotonic(ts, () => 0); // Reset internal state
        // Set the internal state to our crafted ID's values
        // @ts-expect-error - testing internal state
        Nano64.lastTimestamp = id_before_overflow.getTimestamp();
        // @ts-expect-error - testing internal state
        Nano64.lastRandom = id_before_overflow.value & RAND_MAX;

        const next_id = Nano64.generateMonotonic(ts); // This should increment the random part to its max
        const overflowed_id = Nano64.generateMonotonic(ts); // This one should overflow

        expect(next_id.getTimestamp()).toBe(ts);
        expect(overflowed_id.getTimestamp()).toBe(ts + 1);
        expect(overflowed_id.value & RAND_MAX).toBe(0n); // Random part resets to 0
    });

    it("handles clock moving backward", () => {
        const ts1 = 8_000_000_000;
        const ts2 = ts1 - 100; // Clock moved backward by 100ms

        const id1 = Nano64.generateMonotonic(ts1);
        const id2 = Nano64.generateMonotonic(ts2); // Should ignore ts2

        expect(id2.getTimestamp()).toBe(ts1); // Timestamp does not go backward
        expect(Nano64.compare(id1, id2)).toBe(-1); // id2 is still greater than id1
    });
});

describe("Nano64 range queries", () => {
    it("calculates correct bounds for a time range", () => {
        const tsStart = 1672531200000; // 2023-01-01T00:00:00.000Z
        const tsEnd = 1672617599999;   // 2023-01-01T23:59:59.999Z

        const { start, end } = Nano64.timeRangeToBytes(tsStart, tsEnd);

        // Manually calculate the expected bounds
        const RAND_MAX = (1n << RANDOM_BITS) - 1n;
        const expectedLow = BigInt(tsStart) << RANDOM_BITS;
        const expectedHigh = (BigInt(tsEnd) << RANDOM_BITS) | RAND_MAX;

        expect(BigIntHelpers.fromBytesBE(start)).toBe(expectedLow);
        expect(BigIntHelpers.fromBytesBE(end)).toBe(expectedHigh);
    });

    it("calculates correct bounds for a single millisecond", () => {
        const ts = 1700000000000;
        const { start, end } = Nano64.timeRangeToBytes(ts, ts);

        const RAND_MAX = (1n << RANDOM_BITS) - 1n;
        const expectedLow = BigInt(ts) << RANDOM_BITS;
        const expectedHigh = (BigInt(ts) << RANDOM_BITS) | RAND_MAX;

        expect(BigIntHelpers.fromBytesBE(start)).toBe(expectedLow);
        expect(BigIntHelpers.fromBytesBE(end)).toBe(expectedHigh);
    });

    it("throws an error for invalid ranges", () => {
        // Start time is after end time
        expect(() => Nano64.timeRangeToBytes(2000, 1000)).toThrow();
        // Negative timestamp
        expect(() => Nano64.timeRangeToBytes(-100, 1000)).toThrow();
        // Timestamp out of 44-bit range
        const limit = 2 ** Number(TIMESTAMP_BITS);
        expect(() => Nano64.timeRangeToBytes(0, limit)).toThrow();
    });
});

describe("Nano64 with in-memory SQLite", () => {
    let db: Database.Database;
    const ROWS_PER_MS = 1000;
    const baseTimestamps = [
        100, // Dec 31, 1969
        1729000000000,
        1730000000000,
        1731000000000,
        17580000000000, // Feb 1, 2527
    ];
	const TOTAL_ROWS = ROWS_PER_MS * baseTimestamps.length;

    // Setup: Create and populate the database
    beforeAll(() => {
        db = new Database(":memory:");

		// store the ID and it's associated timestamp
        db.exec("CREATE TABLE events (id BLOB PRIMARY KEY, timestamp INTEGER NOT NULL)");

        const insert = db.prepare("INSERT INTO events (id, timestamp) VALUES (?, ?)");
        const insertMany = db.transaction((ids: Nano64[]) => {
            for (const id of ids) {
                insert.run(Buffer.from(id.toBytes()), id.getTimestamp());
            }
        });

        const allIds: Nano64[] = [];
        for (const ts of baseTimestamps) {
            for (let i = 0; i < ROWS_PER_MS; i++) {
                allIds.push(Nano64.generateMonotonic(ts));
            }
        }
        insertMany(allIds);
    });

    // Teardown: Close the database connection
    afterAll(() => {
        db.close();
    });

    it("should have inserted all rows correctly", () => {
        const { count } = db.prepare("SELECT count(*) as count FROM events").get() as { count: number };
        expect(count).toBe(TOTAL_ROWS);
    });

    it("should retrieve all rows for a single millisecond and verify their timestamps", () => {
        const targetTs = baseTimestamps[2]; 
        const { start, end } = Nano64.timeRangeToBytes(targetTs, targetTs);

        const results = db
            .prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
            .all(Buffer.from(start), Buffer.from(end)) as { id: ArrayBuffer, timestamp: number }[];

        // First, check that the correct number of rows was returned.
        expect(results.length).toBe(ROWS_PER_MS);

        // Second, verify that every single returned row has the correct timestamp.
        for (const row of results) {
            expect(row.timestamp).toBe(targetTs);
        }
    });

    it("should retrieve all rows across a range of milliseconds and verify their timestamps", () => {
        const tsStart = baseTimestamps[2]; 
        const tsEnd = baseTimestamps[4]; 
        const { start, end } = Nano64.timeRangeToBytes(tsStart, tsEnd);

        const results = db
            .prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
            .all(Buffer.from(start), Buffer.from(end)) as { id: ArrayBuffer, timestamp: number }[];

        // Check the total count for the 3ms range.
        expect(results.length).toBe(ROWS_PER_MS * 3);

        // Verify that every single returned row's timestamp is within the queried bounds.
        for (const row of results) {
            expect(row.timestamp).toBeGreaterThanOrEqual(tsStart);
            expect(row.timestamp).toBeLessThanOrEqual(tsEnd);
        }
    });

    it("should retrieve zero rows for an empty range", () => {
        const emptyTs = 1800000000000; // A timestamp where no data exists
        const { start, end } = Nano64.timeRangeToBytes(emptyTs, emptyTs);

        const results = db
            .prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
            .all(Buffer.from(start), Buffer.from(end)) as { id: ArrayBuffer, timestamp: number }[];

        expect(results.length).toBe(0);
    });
});


describe("AES-GCM bindings", () => {
    it("encrypts and decrypts", async () => {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const enc = Nano64.encryptedFactory(key);
        const id = Nano64.generate(1234567890, () => 0xABCDE & ((1 << 20) - 1));
        const wrapped = await enc.encrypt(id);
        expect(wrapped.toEncryptedBytes().length).toBe(36);
        const parsed = await enc.fromEncryptedHex(wrapped.toEncryptedHex());
        expect(parsed.id.value).toBe(id.value);
    });

    it("rejects wrong lengths and tampering", async () => {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const enc = Nano64.encryptedFactory(key);
        const wrapped = await enc.generateEncrypted();

        const bad = wrapped.toEncryptedBytes().slice(0, 35); // too short
        await expect(enc.fromEncryptedBytes(bad as any)).rejects.toThrow();

        const tampered = wrapped.toEncryptedBytes();
        tampered[20] ^= 0x01; // flip one bit in ciphertext
        await expect(enc.fromEncryptedBytes(tampered)).rejects.toThrow();
    });

    it("encryption does not reveal plaintext timestamp prefix", async () => {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const enc = Nano64.encryptedFactory(key);
        const id = Nano64.generate();
        const hexId = id.toHex();
        const wrapped = await enc.encrypt(id);
        const encHex = wrapped.toEncryptedHex();
        // first 10 hex chars of id should not appear in payload
        expect(encHex.includes(hexId.slice(0, 10))).toBe(false);
    });
});

/*


function examples() {

    // Example usage:
    const ulid = Nano64.generate();
    console.log("UInt64:", ulid.toHex());
    console.log("Base16:", ulid.toBytes().toString());
    console.log("Timestamp:", ulid.getTimestamp());

    const roundTrip = Nano64.fromHex(ulid.toHex());
    console.log("Round trip match:", roundTrip.value === ulid.value);

    (async () => {
        const key = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
        );

        const exported = await window.crypto.subtle.exportKey("raw", key);
        console.log(new Uint8Array(exported));

        // 2. Get the generator bound to that key.
        const enc = Nano64.encryptedId(key);

        // 3. Create an encrypted ID.
        const encryptedID = await enc.generateEncrypted()   // => 72-char hex string

        // 4. Later (or on another client with the same key) decode it.
        const original = await enc.fromEncryptedHex(encryptedID.toEncryptedHex()); // => NanoULID instance
        console.log("ENCRYPTED", original.id.toHex(), encryptedID.toEncryptedHex()); // 16-char ULID hex
        console.log(original.id.getTimestamp(), encryptedID.id.getTimestamp());

        let start = Date.now();
        for (let i = 0; i < 100; i++) {
            await enc.generateEncrypted()
        }
        console.log(Date.now() - start);

    })()
}

*/