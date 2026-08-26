import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

interface CacheEnvelope<T> {
  schemaVersion: 1;
  createdAt: string;
  value: T;
}

export function stableCacheKey(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class FileCache {
  private readonly directory: string;

  constructor(directory?: string) {
    const base = process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    this.directory = directory || path.join(base, "agentsmith", "analysis");
  }

  async get<T>(key: string, ttlSeconds: number): Promise<T | undefined> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.filePath(key), "utf-8"));
      if (!raw || typeof raw !== "object") return undefined;
      const envelope = raw as Partial<CacheEnvelope<T>>;
      if (envelope.schemaVersion !== 1 || !envelope.createdAt || envelope.value === undefined) {
        return undefined;
      }
      const age = Date.now() - Date.parse(envelope.createdAt);
      if (!Number.isFinite(age) || age > ttlSeconds * 1000) return undefined;
      return envelope.value;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const envelope: CacheEnvelope<T> = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      value,
    };
    await fs.writeFile(this.filePath(key), `${JSON.stringify(envelope)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  async clear(): Promise<void> {
    await fs.rm(this.directory, { recursive: true, force: true });
  }

  private filePath(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid cache key");
    return path.join(this.directory, `${key}.json`);
  }
}
