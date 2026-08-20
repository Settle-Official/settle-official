/**
 * Node's native ESM loader (used by `node --test`) requires explicit file
 * extensions on relative specifiers. This app's source files intentionally
 * use extensionless relative imports (Next.js/webpack-bundler convention,
 * e.g. `./constants` not `./constants.ts`) — rewriting that style project-wide
 * to satisfy the test runner would be a large, risky change for no benefit
 * outside tests. This hook bridges the gap instead: for a relative specifier
 * with no extension, try `.ts` first, then fall back to Node's normal
 * resolution (so `.js`, `.json`, directory imports, etc. still work).
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);
    if (isRelative && !hasExtension) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through to default resolution below.
      }
    }
    return nextResolve(specifier, context);
  },
});
