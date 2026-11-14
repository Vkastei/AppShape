import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aiProvider } from "@appshape/ai";
import type { AiKeyStore } from "@appshape/server";
import { app, safeStorage } from "electron";

/**
 * The API key of AppShape's AI in the desktop app: encrypted with the OS keychain (Electron's
 * safeStorage: DPAPI on Windows, the Keychain on macOS, libsecret on Linux) in the app's own
 * folder, one file per provider. The provider's environment variable (ANTHROPIC_API_KEY, …), when
 * set, wins. Never in a project, never in the browser.
 */
export function keychainKeyStore(): AiKeyStore {
  // Anthropic's key keeps the file name it had before there were providers
  const file = (provider: string) => join(app.getPath("userData"), provider === "anthropic" ? "ai-key.bin" : `ai-key-${provider}.bin`);
  return {
    async get(provider) {
      const env = process.env[aiProvider(provider).keyEnv];
      if (env) return { key: env, source: "env" };
      if (!safeStorage.isEncryptionAvailable()) return undefined;
      try {
        return { key: safeStorage.decryptString(await readFile(file(provider))), source: "keychain" };
      } catch {
        return undefined;
      }
    },
    async set(provider, key) {
      if (key === null) {
        await rm(file(provider), { force: true });
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer's keychain isn't available: set ANTHROPIC_API_KEY instead.");
      await writeFile(file(provider), safeStorage.encryptString(key.trim()));
    },
  };
}
