// Ensure WebCrypto is available in Node test runtime.
if (!(globalThis as any).crypto) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (globalThis as any).crypto = require("node:crypto").webcrypto;
  } catch {
    throw new Error("Web Crypto not available; use Node 18+.");
  }
}