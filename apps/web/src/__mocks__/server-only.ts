// Stub for the `server-only` npm package.
// In Next.js production, `server-only` throws when imported on the client.
// In Vitest tests (Node environment), the package is not resolvable without
// this alias. This stub is a no-op — the test environment is already server-side.
export {};
