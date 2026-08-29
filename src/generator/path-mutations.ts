import crypto from "crypto";
import { constants } from "fs";
import fs from "fs/promises";
import type { FileHandle } from "fs/promises";
import path from "path";
import {
  assertFileStillMatches,
  assertPlainFileStat,
  assertTargetAbsent,
  openDirectoryChain,
  openDirectoryWitness,
  openExistingFile,
  maybeOpenExistingFile,
  relativeSegments,
  resolveContainedFileForWrite,
  validateDirectoryChain,
  type ContainedRoot,
  type ExistingFile,
} from "./path-core.js";
import {
  anchoredChildPath,
  closeDirectoryWitnesses,
  identityOf,
  NO_FOLLOW,
  sameIdentity,
  syncDirectory,
  writeAll,
  type FileIdentity,
} from "./path-witness.js";

function temporaryName(fileName: string): string {
  return `.agentsmith-${fileName}-${crypto.randomUUID()}.tmp`;
}

export async function atomicWriteContainedFile(
  root: ContainedRoot,
  filePath: string,
  content: string,
): Promise<string> {
  const target = await resolveContainedFileForWrite(root, filePath);
  const witnesses = await openDirectoryChain(root, path.dirname(target));
  const parent = witnesses[witnesses.length - 1];
  const fileName = path.basename(target);
  const targetAnchor = anchoredChildPath(parent, fileName);
  const tempName = temporaryName(fileName);
  const tempAnchor = anchoredChildPath(parent, tempName);
  let existing: ExistingFile | undefined;
  let replacing = false;
  let replacementMode = 0o600;
  let tempHandle: FileHandle | undefined;
  let tempIdentity: FileIdentity | undefined;
  let committed = false;

  try {
    existing = await maybeOpenExistingFile(root, parent, fileName);
    replacing = existing !== undefined;
    replacementMode = existing ? existing.mode & 0o777 : 0o600;
    await validateDirectoryChain(root, witnesses);
    tempHandle = await fs.open(
      tempAnchor,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      replacementMode,
    );
    const tempStat = await tempHandle.stat({ bigint: true });
    if (!tempStat.isFile() || tempStat.nlink !== 1n) {
      throw new Error(`Unsafe generated staging file: ${target}`);
    }
    tempIdentity = identityOf(tempStat);
    await writeAll(tempHandle, Buffer.from(content, "utf-8"));
    await tempHandle.close();
    tempHandle = undefined;

    await validateDirectoryChain(root, witnesses);
    if (existing) {
      await assertFileStillMatches(existing);
      await existing.handle.close();
      existing = undefined;
    } else {
      await assertTargetAbsent(target, targetAnchor);
    }

    if (replacing) {
      await fs.rename(tempAnchor, targetAnchor);
    } else {
      await fs.link(tempAnchor, targetAnchor);
      await validateDirectoryChain(root, witnesses);
      const linkedTarget = await fs.lstat(targetAnchor, { bigint: true });
      const staged = await fs.lstat(tempAnchor, { bigint: true });
      if (
        !linkedTarget.isFile()
        || !staged.isFile()
        || !sameIdentity(tempIdentity, linkedTarget)
        || !sameIdentity(tempIdentity, staged)
      ) {
        throw new Error(`Unsafe generated target changed identity after creation: ${target}`);
      }
      await fs.unlink(tempAnchor);
    }
    committed = true;

    await validateDirectoryChain(root, witnesses);
    const finalRequested = await fs.lstat(target, { bigint: true });
    const finalAnchored = await fs.lstat(targetAnchor, { bigint: true });
    assertPlainFileStat(finalRequested, target);
    assertPlainFileStat(finalAnchored, target);
    if (
      !sameIdentity(tempIdentity, finalRequested)
      || !sameIdentity(tempIdentity, finalAnchored)
    ) {
      throw new Error(`Unsafe generated target changed identity after write: ${target}`);
    }
    await syncDirectory(parent);
    return target;
  } finally {
    await tempHandle?.close().catch(() => undefined);
    await existing?.handle.close().catch(() => undefined);
    if (!committed && tempIdentity) {
      try {
        await validateDirectoryChain(root, witnesses);
        const staged = await fs.lstat(tempAnchor, { bigint: true });
        if (
          staged.isFile()
          && staged.nlink === 1n
          && sameIdentity(tempIdentity, staged)
        ) {
          await fs.unlink(tempAnchor);
        }
      } catch {
        // A changed parent or staging identity is never safe to clean by pathname.
      }
    }
    await closeDirectoryWitnesses(witnesses);
  }
}

export async function removeContainedExistingFile(
  root: ContainedRoot,
  filePath: string,
  expectedDigest?: string,
): Promise<void> {
  const segments = relativeSegments(root, filePath);
  if (segments.length === 0) {
    throw new Error(`Generated file path resolves to output root: ${filePath}`);
  }
  const fileName = segments.pop()!;
  const witnesses = await openDirectoryChain(
    root,
    path.join(root.requestedRoot, ...segments),
  );
  const parent = witnesses[witnesses.length - 1];
  let file: ExistingFile | undefined;
  const quarantineName = `.agentsmith-remove-${crypto.randomUUID()}`;
  const quarantinePath = path.join(parent.path, quarantineName);
  const quarantineAnchor = anchoredChildPath(parent, quarantineName);
  let moved = false;
  let removed = false;
  try {
    file = await openExistingFile(root, parent, fileName);
    if (expectedDigest) {
      const bytes = await file.handle.readFile();
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      if (digest !== expectedDigest) {
        throw new Error(`Generated target content changed before removal: ${file.requestedPath}`);
      }
    }
    await validateDirectoryChain(root, witnesses);
    await assertFileStillMatches(file);
    const identity = file.identity;
    const requestedPath = file.requestedPath;
    const anchoredPath = file.anchoredPath;
    await file.handle.close();
    file = undefined;
    const current = await fs.lstat(requestedPath, { bigint: true });
    const anchored = await fs.lstat(anchoredPath, { bigint: true });
    assertPlainFileStat(current, requestedPath);
    assertPlainFileStat(anchored, requestedPath);
    if (!sameIdentity(identity, current) || !sameIdentity(identity, anchored)) {
      throw new Error(`Unsafe generated target changed identity: ${requestedPath}`);
    }
    await fs.mkdir(quarantineAnchor);
    const quarantine = await openDirectoryWitness(root, quarantinePath, parent);
    witnesses.push(quarantine);
    const tombstone = anchoredChildPath(quarantine, fileName);
    await validateDirectoryChain(root, witnesses);
    await fs.rename(anchoredPath, tombstone);
    moved = true;
    await validateDirectoryChain(root, witnesses);
    const quarantined = await fs.lstat(tombstone, { bigint: true });
    assertPlainFileStat(quarantined, requestedPath);
    if (!sameIdentity(identity, quarantined)) {
      throw new Error(`Unsafe generated target changed identity during removal: ${requestedPath}`);
    }
    await fs.unlink(tombstone);
    removed = true;
    await validateDirectoryChain(root, witnesses);
    await fs.rmdir(quarantineAnchor);
    await syncDirectory(parent);
  } finally {
    await file?.handle.close().catch(() => undefined);
    if (!moved || removed) {
      try {
        await validateDirectoryChain(root, witnesses);
        await fs.rmdir(quarantineAnchor);
      } catch {
        // Never clean up through a path whose parent identity changed.
      }
    }
    await closeDirectoryWitnesses(witnesses);
  }
}
