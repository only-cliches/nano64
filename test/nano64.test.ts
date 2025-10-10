import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Nano64, Hex, BigIntHelpers, TIMESTAMP_BITS, RANDOM_BITS, veryUnsafeRNG, MonotonicNano64Generator, SignedNano64 } from "../src/index";
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
		const b = Nano64.fromUnsignedBigInt(a.value); // Exact copy
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
		const RAND_MAX_NUM = (1 << Number(RANDOM_BITS)) - 1;

		// 1. Create an instance of the new generator.
		const generator = new MonotonicNano64Generator();

		// 2. Use a custom RNG to generate an ID with random bits set to the
		//    second-to-last possible value (0b111...110).
		//    This puts the generator's internal state one step away from the max.
		generator.next(ts, () => RAND_MAX_NUM - 1);

		// 3. The next call in the same millisecond will increment the random part to its
		//    maximum value (0b111...111).
		const next_id = generator.next(ts);

		// 4. This final call will cause the random part to overflow (wrap around to 0),
		//    which must trigger the timestamp to be bumped by 1ms.
		const overflowed_id = generator.next(ts);

		expect(next_id.getTimestamp()).toBe(ts);
		expect(overflowed_id.getTimestamp()).toBe(ts + 1);
		expect(overflowed_id.value & ((1n << RANDOM_BITS) - 1n)).toBe(0n);
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

		const [start, end] = Nano64.timeRangeToBytes(tsStart, tsEnd);

		// Manually calculate the expected bounds
		const RAND_MAX = (1n << RANDOM_BITS) - 1n;
		const expectedLow = BigInt(tsStart) << RANDOM_BITS;
		const expectedHigh = (BigInt(tsEnd) << RANDOM_BITS) | RAND_MAX;

		expect(BigIntHelpers.fromBytesBE(start)).toBe(expectedLow);
		expect(BigIntHelpers.fromBytesBE(end)).toBe(expectedHigh);
	});

	it("calculates correct bounds for a single millisecond", () => {
		const ts = 1700000000000;
		const [start, end] = Nano64.timeRangeToBytes(ts, ts);

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

describe("SignedNano64 with in-memory SQLite", () => {
	let db: Database.Database;

	const ROWS_PER_MS = 1000;
	// Use the same timestamps as the unsigned test for a direct comparison
	const baseTimestamps = [
		100,             // 1970
		4395000000000,   // 2019
		8790000000000,   // 2248
		13185000000000,  // 2307
		17580000000000,  // 2527 (near max)
	];
	const TOTAL_ROWS = ROWS_PER_MS * baseTimestamps.length;

	// Setup: Create and populate the database
	beforeAll(() => {
		db = new Database(":memory:");

		// In SQLite, INTEGER can store up to a signed 64-bit value.
		db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL)");

		const insert = db.prepare("INSERT INTO events (id, timestamp) VALUES (?, ?)");
		const insertMany = db.transaction((ids: Nano64[]) => {
			for (const id of ids) {
				const signedId = SignedNano64.fromId(id);
				insert.run(signedId, id.getTimestamp());
			}
		});

		const allIds: Nano64[] = [];
		for (const ts of baseTimestamps) {
			const generator = new MonotonicNano64Generator();
			for (let i = 0; i < ROWS_PER_MS; i++) {
				allIds.push(generator.next(ts));
			}
		}
		insertMany(allIds);
	});

	// Teardown: Close the database connection
	afterAll(() => {
		db.close();
	});

	it("should have inserted all rows correctly", () => {
		const results = db.prepare("SELECT * FROM events").all() as { id: bigint, timestamp: number }[];
		expect(results.length).toBe(TOTAL_ROWS);
	});

	it("should retrieve all rows for a single millisecond and verify their timestamps", () => {
		const targetTs = baseTimestamps[2];
		const [ start, end ] = SignedNano64.timeRangeToBigInts(targetTs, targetTs);

		const results = db
			.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
			.all(start, end) as { id: bigint, timestamp: number }[];

		expect(results.length).toBe(ROWS_PER_MS);
		for (const row of results) {
			expect(row.timestamp).toBe(targetTs);
		}
	});

	it("should retrieve all rows across a range of milliseconds and verify their timestamps", () => {
		const tsStart = baseTimestamps[1];
		const tsEnd = baseTimestamps[3];
		const [ start, end ] = SignedNano64.timeRangeToBigInts(tsStart, tsEnd);

		const results = db
			.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
			.all(start, end) as { id: bigint, timestamp: number }[];

		expect(results.length).toBe(ROWS_PER_MS * 3);
		for (const row of results) {
			expect(row.timestamp).toBeGreaterThanOrEqual(tsStart);
			expect(row.timestamp).toBeLessThanOrEqual(tsEnd);
		}
	});

	it("should retrieve zero rows for an empty range", () => {
		const emptyTs = 1800000000000; // A timestamp where no data exists
		const [ start, end ] = SignedNano64.timeRangeToBigInts(emptyTs, emptyTs + 10000);

		const results = db
			.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
			.all(start, end) as { id: bigint, timestamp: number }[];

		expect(results.length).toBe(0);
	});
});

describe("Nano64 with in-memory SQLite", () => {
	let db: Database.Database;

	const ROWS_PER_MS = 1000;
	const baseTimestamps = [
		100,             // 1970
		4395000000000,   // 2019
		8790000000000,   // 2248
		13185000000000,  // 2307
		17580000000000,  // 2527 (near max)
	];
	const TOTAL_ROWS = ROWS_PER_MS * baseTimestamps.length;

	// Setup: Create and populate the database
	beforeAll(() => {
		db = new Database(":memory:");

		// store the ID and it's associated timestamp
		db.exec("CREATE TABLE events (id BLOB PRIMARY KEY, timestamp INTEGER NOT NULL) WITHOUT ROWID");

		const insert = db.prepare("INSERT INTO events (id, timestamp) VALUES (?, ?)");
		const insertMany = db.transaction((ids: Nano64[]) => {
			for (const id of ids) {
				insert.run(id.toBytes(), id.getTimestamp());
			}
		});

		const allIds: Nano64[] = [];
		for (const ts of baseTimestamps) {
			const fact = Nano64.monotonicFactory();
			for (let i = 0; i < ROWS_PER_MS; i++) {
				allIds.push(fact.next(ts));
			}
		}
		insertMany(allIds);
	});

	// Teardown: Close the database connection
	afterAll(() => {
		db.close();
	});

	it("should have inserted all rows correctly", () => {
		const records = db.prepare("SELECT * FROM events").all() as { id: ArrayBuffer, timestamp: number }[];
		expect(records.length).toBe(TOTAL_ROWS);
	});

	it("should retrieve all rows for a single millisecond and verify their timestamps", () => {
		const targetTs = baseTimestamps[2];
		const [start, end] = Nano64.timeRangeToBytes(targetTs, targetTs);

		const results = db
			.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
			.all(start, end) as { id: ArrayBuffer, timestamp: number }[];

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
		const [start, end] = Nano64.timeRangeToBytes(tsStart, tsEnd);

		const results = db
			.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
			.all(start, end) as { id: ArrayBuffer, timestamp: number }[];

		// Check the total count for the 3ms range.
		expect(results.length).toBe(ROWS_PER_MS * 3);

		// Verify that every single returned row's timestamp is within the queried bounds.
		for (const row of results) {
			expect(row.timestamp).toBeGreaterThanOrEqual(tsStart);
			expect(row.timestamp).toBeLessThanOrEqual(tsEnd);
		}
	});

	it("should retrieve all rows across a range of milliseconds and verify their timestamps (2)", () => {
		const tsStart = baseTimestamps[0];
		const tsEnd = baseTimestamps[2];
		const [start, end] = Nano64.timeRangeToBytes(tsStart, tsEnd);

		const results = db
			.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
			.all(start, end) as { id: ArrayBuffer, timestamp: number }[];

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
		const [start, end] = Nano64.timeRangeToBytes(emptyTs, emptyTs + 10000);

		const results = db
			.prepare("SELECT * FROM events WHERE id BETWEEN ? AND ?")
			.all(start, end) as { id: ArrayBuffer, timestamp: number }[];

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

describe("SignedNano64 class", () => {
    // A few timestamps to test against, covering different ranges.
    const testTimestamps = [
        100, // An early date in 1970
        1665277745000, // A date in 2022
        17580000000000, // A date in 2527, near the max limit
    ];

    it("should round-trip Nano64 <-> signed BigInt correctly", () => {
        for (const ts of testTimestamps) {
            const originalId = Nano64.generate(ts);

            // 1. Convert from Nano64 to a signed BigInt
            const signedId = SignedNano64.fromId(originalId);

            // 2. Convert the signed BigInt back to a Nano64
            const reconstructedId = SignedNano64.toId(signedId);

            // 3. Verify that the final ID is identical to the original
            expect(reconstructedId.equals(originalId)).toBe(true);
            expect(reconstructedId.value).toBe(originalId.value);
        }
    });

    it("should extract the correct timestamp directly from a signed BigInt", () => {
        for (const ts of testTimestamps) {
            const originalId = Nano64.generate(ts);
            const signedId = SignedNano64.fromId(originalId);

            // 1. Extract the timestamp directly from the signed value
            const extractedTimestamp = SignedNano64.getTimestamp(signedId);

            // 2. Verify it matches the original timestamp
            expect(extractedTimestamp).toBe(ts);
        }
    });

    it("should calculate correct signed bounds for a time range", () => {
        const tsStart = 1672531200000; // 2023-01-01T00:00:00.000Z
        const tsEnd = 1672617599999;   // 2023-01-01T23:59:59.999Z

        // 1. Get the signed bounds from the function
        const [ start, end ] = SignedNano64.timeRangeToBigInts(tsStart, tsEnd);

        // 2. Manually calculate the expected unsigned bounds
        const SIGN_BIT = 1n << 63n;
        const RAND_MAX = (1n << RANDOM_BITS) - 1n;
        const expectedUnsignedStart = (BigInt(tsStart) << RANDOM_BITS);
        const expectedUnsignedEnd = (BigInt(tsEnd) << RANDOM_BITS) | RAND_MAX;

        // 3. Manually convert the unsigned bounds to signed bounds
        const expectedSignedStart = expectedUnsignedStart - SIGN_BIT;
        const expectedSignedEnd = expectedUnsignedEnd - SIGN_BIT;

        // 4. Verify the function's output matches the manual calculation
        expect(start).toBe(expectedSignedStart);
        expect(end).toBe(expectedSignedEnd);
    });

    it("should throw an error for invalid time ranges", () => {
        // Case 1: Start time is after end time
        expect(() => {
            SignedNano64.timeRangeToBigInts(2000, 1000);
        }).toThrow("tsStart must be less than or equal to tsEnd.");

        // Case 2: Negative timestamp
        expect(() => {
            SignedNano64.timeRangeToBigInts(-100, 1000);
        }).toThrow("Timestamps must be non-negative.");

        // Case 3: Timestamp out of 44-bit range
        const limit = Number((1n << TIMESTAMP_BITS));
        expect(() => {
            SignedNano64.timeRangeToBigInts(0, limit);
        }).toThrow(`Timestamp exceeds the ${Number(TIMESTAMP_BITS)}-bit range.`);
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

		const exported = await crypto.subtle.exportKey("raw", key);
	    
		const importedKey = await crypto.subtle.importKey("raw", exported, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

		// 2. Get the generator bound to that key.
		const enc = Nano64.encryptedFactory(key);
		const enc2 = Nano64.encryptedFactory(importedKey);

		// 3. Create an encrypted ID.
		const encryptedID = await enc.generateEncrypted()   // => 72-char hex string

		// 4. Later (or on another client with the same key) decode it.
		const original = await enc2.fromEncryptedHex(encryptedID.toEncryptedHex()); // => NanoULID instance
		console.log("ENCRYPTED", original.id.toHex(), encryptedID.toEncryptedHex()); // 16-char ULID hex
		console.log(original.id.getTimestamp(), encryptedID.id.getTimestamp());

		let results = [];
		let start = Date.now();
		for (let i = 0; i < 100000; i++) {
			results.push(Nano64.generate());
		}
		console.log(Date.now() - start);


		start = Date.now();
		for (let i = 0; i < 100000; i++) {
			results.push(Nano64.generateMonotonic());
		}
		console.log(Date.now() - start);

	})()
}

examples()

*/