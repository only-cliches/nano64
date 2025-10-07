import { describe, it, expect } from "vitest";
import { Nano64, Hex, BigIntHelpers, TIMESTAMP_BITS, RANDOM_BITS } from "../src/index";

const U64 = 1n << 64n; const MASK64 = U64 - 1n;

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
		expect(hex).toHaveLength(16);
		const b = id.toBytes();
		const fromHex = Nano64.fromHex(hex);
		const fromBytes = Nano64.fromBytes(b);
		expect(fromHex.value).toBe(id.value);
		expect(fromBytes.value).toBe(id.value);
	});

	it("extracts timestamp", () => {
		const ts = 2_000_000_000; // within 44-bit range
		const id = Nano64.generate(ts, () => 0);
		expect(id.getTimestamp()).toBe(ts);
	});

	it("rejects out-of-range timestamp", () => {
		const limit = Number(1n << TIMESTAMP_BITS);
		expect(() => Nano64.generate(limit)).toThrow();
		expect(() => Nano64.generate(-1)).toThrow();
	});

	it("monotonic increments in same ms", () => {
		const ts = 5_000_000_000;
		const a = Nano64.generateMonotonic(ts, () => 0);
		const b = Nano64.generateMonotonic(ts, () => 0);
		expect(Nano64.compare(a, b)).toBe(-1);
		expect(a.getTimestamp()).toBe(ts);
		expect(b.getTimestamp()).toBe(ts);
	});

	it("monotonic bumps timestamp on overflow", () => {
		const ts = 7_000_000_000;
		// Drive near-overflow by repeated calls
		let last = Nano64.generateMonotonic(ts, () => 0xFFFFF); // random bits: 20 ones
		for (let i = 0; i < (1 << 20) - 2; i++) {
			last = Nano64.generateMonotonic(ts, () => 0);
		}
		const bumped = Nano64.generateMonotonic(ts, () => 0);
		expect(bumped.getTimestamp()).toBe(ts + 1);
	});
});

describe("AES-GCM bindings", () => {
	it("encrypts and decrypts", async () => {
		const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
		const enc = Nano64.encryptedId(key);
		const id = Nano64.generate(1234567890, () => 0xABCDE & ((1 << 20) - 1));
		const wrapped = await enc.encrypt(id);
		expect(wrapped.toEncryptedBytes().length).toBe(36);
		const parsed = await enc.fromEncryptedHex(wrapped.toEncryptedHex());
		expect(parsed.id.value).toBe(id.value);
	});

	it("rejects wrong lengths and tampering", async () => {
		const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
		const enc = Nano64.encryptedId(key);
		const wrapped = await enc.generateEncrypted();

		const bad = wrapped.toEncryptedBytes().slice(0, 35); // too short
		await expect(enc.fromEncryptedBytes(bad as any)).rejects.toThrow();

		const tampered = wrapped.toEncryptedBytes();
		tampered[20] ^= 0x01; // flip one bit in ciphertext
		await expect(enc.fromEncryptedBytes(tampered)).rejects.toThrow();
	});
});