import { constants, existsSync } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";

export interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

export interface DirectoryWitness {
  path: string;
  handle: FileHandle;
  identity: FileIdentity;
}

const OPTIONAL_FLAGS = constants as unknown as Record<string, number | undefined>;

export const NO_FOLLOW = OPTIONAL_FLAGS.O_NOFOLLOW ?? 0;
export const DIRECTORY_ONLY = OPTIONAL_FLAGS.O_DIRECTORY ?? 0;

const FILE_DESCRIPTOR_ROOT = process.platform === "linux" && existsSync("/proc/self/fd")
  ? "/proc/self/fd"
  : process.platform !== "win32" && existsSync("/dev/fd")
    ? "/dev/fd"
    : undefined;

export function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function identityOf(stat: { dev: bigint; ino: bigint }): FileIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

export function sameIdentity(
  left: FileIdentity,
  right: { dev: bigint; ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function anchoredDirectoryPath(witness: DirectoryWitness): string {
  return FILE_DESCRIPTOR_ROOT
    ? path.join(FILE_DESCRIPTOR_ROOT, String(witness.handle.fd))
    : witness.path;
}

export function anchoredChildPath(
  witness: DirectoryWitness,
  childName: string,
): string {
  if (
    !childName
    || childName === "."
    || childName === ".."
    || path.basename(childName) !== childName
  ) {
    throw new Error(`Unsafe anchored child name: ${childName}`);
  }
  return path.join(anchoredDirectoryPath(witness), childName);
}

export async function closeDirectoryWitnesses(
  witnesses: DirectoryWitness[],
): Promise<void> {
  await Promise.all(
    witnesses.map((witness) => witness.handle.close().catch(() => undefined)),
  );
}

export async function writeAll(
  handle: FileHandle,
  content: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < content.length) {
    const { bytesWritten } = await handle.write(
      content,
      offset,
      content.length - offset,
      offset,
    );
    if (bytesWritten === 0) {
      throw new Error("Unable to make progress writing generated content");
    }
    offset += bytesWritten;
  }
  await handle.sync();
}

export async function syncDirectory(witness: DirectoryWitness): Promise<void> {
  try {
    await witness.handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "EBADF", "EPERM", "ENOTSUP"].includes(code ?? "")) {
      throw error;
    }
  }
}
