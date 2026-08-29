import { constants } from "fs";
import fs from "fs/promises";
import type { Dirent } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import {
  anchoredChildPath,
  anchoredDirectoryPath,
  closeDirectoryWitnesses,
  DIRECTORY_ONLY,
  identityOf,
  isNotFound,
  NO_FOLLOW,
  sameIdentity,
  type DirectoryWitness,
  type FileIdentity,
} from "./path-witness.js";

export interface ContainedRoot {
  requestedRoot: string;
  realRoot: string;
}
export interface ExistingFile {
  handle: FileHandle;
  identity: FileIdentity;
  mode: number;
  requestedPath: string;
  anchoredPath: string;
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const rootIdentities = new WeakMap<ContainedRoot, FileIdentity>();

export function assertPortablePathComponents(
  filePath: string,
  label = "generated path",
): void {
  for (const component of filePath.replace(/\\/g, "/").split("/")) {
    if (!component || component === "." || component === "..") continue;
    const hasControlCharacter = Array.from(component)
      .some((character) => character.charCodeAt(0) < 32);
    if (
      component.includes(":")
      || /[<>"|?*]/.test(component)
      || hasControlCharacter
      || /[. ]$/.test(component)
      || WINDOWS_DEVICE.test(component)
    ) {
      throw new Error(`Unsafe ${label} component: ${component}`);
    }
  }
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
}

function assertContained(root: string, target: string): void {
  if (!isContained(root, target)) {
    throw new Error(`Unsafe generated path escapes output root: ${target}`);
  }
}

function comparable(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertNotRedirected(
  root: ContainedRoot,
  requestedPath: string,
  realPath: string,
): void {
  const relative = path.relative(root.requestedRoot, path.resolve(requestedPath));
  const expected = path.join(root.realRoot, relative);
  if (comparable(expected) !== comparable(realPath)) {
    throw new Error(`Unsafe generated path contains a reparse-point redirect: ${requestedPath}`);
  }
}

export function relativeSegments(root: ContainedRoot, target: string): string[] {
  const absoluteTarget = path.resolve(target);
  assertContained(root.requestedRoot, absoluteTarget);
  const relative = path.relative(root.requestedRoot, absoluteTarget);
  const segments = relative === "" ? [] : relative.split(path.sep).filter(Boolean);
  for (const segment of segments) assertPortablePathComponents(segment);
  return segments;
}

async function createRootDescriptor(
  rootPath: string,
  create: boolean,
): Promise<ContainedRoot> {
  const requestedRoot = path.resolve(rootPath);
  if (create) await fs.mkdir(requestedRoot, { recursive: true });
  const stat = await fs.lstat(requestedRoot, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Unsafe generated output root: ${requestedRoot}`);
  }
  const root = {
    requestedRoot,
    realRoot: await fs.realpath(requestedRoot),
  };
  rootIdentities.set(root, identityOf(stat));
  return root;
}

function expectedRootIdentity(root: ContainedRoot): FileIdentity {
  const identity = rootIdentities.get(root);
  if (!identity) {
    throw new Error("Contained root was not opened by AgentSmith");
  }
  return identity;
}

async function validateDirectoryPath(
  root: ContainedRoot,
  requestedPath: string,
  identity: FileIdentity,
): Promise<void> {
  const current = await fs.lstat(requestedPath, { bigint: true });
  if (
    current.isSymbolicLink()
    || !current.isDirectory()
    || !sameIdentity(identity, current)
  ) {
    throw new Error(`Unsafe generated directory changed identity: ${requestedPath}`);
  }
  const resolved = await fs.realpath(requestedPath);
  assertContained(root.realRoot, resolved);
  assertNotRedirected(root, requestedPath, resolved);
}

export async function openDirectoryWitness(
  root: ContainedRoot,
  requestedPath: string,
  parent?: DirectoryWitness,
): Promise<DirectoryWitness> {
  const openedPath = parent
    ? anchoredChildPath(parent, path.basename(requestedPath))
    : requestedPath;
  const before = await fs.lstat(requestedPath, { bigint: true });
  if (before.isSymbolicLink()) {
    throw new Error(
      `Unsafe generated path contains a symbolic link or junction: ${requestedPath}`,
    );
  }
  if (!before.isDirectory()) {
    throw new Error(`Unsafe generated directory changed identity: ${requestedPath}`);
  }
  const beforeIdentity = identityOf(before);
  if (!parent && !sameIdentity(expectedRootIdentity(root), before)) {
    throw new Error(`Unsafe generated output root changed identity: ${requestedPath}`);
  }

  const handle = await fs.open(
    openedPath,
    constants.O_RDONLY | DIRECTORY_ONLY | NO_FOLLOW,
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || !sameIdentity(beforeIdentity, opened)) {
      throw new Error(`Unsafe generated directory changed identity: ${requestedPath}`);
    }
    await validateDirectoryPath(root, requestedPath, beforeIdentity);
    return { path: requestedPath, handle, identity: beforeIdentity };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function openDirectoryChain(
  root: ContainedRoot,
  directoryPath: string,
): Promise<DirectoryWitness[]> {
  const segments = relativeSegments(root, directoryPath);
  const witnesses: DirectoryWitness[] = [];
  try {
    let current = root.requestedRoot;
    witnesses.push(await openDirectoryWitness(root, current));
    for (const segment of segments) {
      current = path.join(current, segment);
      witnesses.push(
        await openDirectoryWitness(root, current, witnesses[witnesses.length - 1]),
      );
    }
    return witnesses;
  } catch (error) {
    await closeDirectoryWitnesses(witnesses);
    throw error;
  }
}

export async function validateDirectoryChain(
  root: ContainedRoot,
  witnesses: DirectoryWitness[],
): Promise<void> {
  for (const witness of witnesses) {
    const opened = await witness.handle.stat({ bigint: true });
    if (!opened.isDirectory() || !sameIdentity(witness.identity, opened)) {
      throw new Error(`Unsafe generated directory changed identity: ${witness.path}`);
    }
    await validateDirectoryPath(root, witness.path, witness.identity);
  }
}

export function assertPlainFileStat(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
  filePath: string,
): void {
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Unsafe generated path is a symbolic link or reparse point: ${filePath}`);
  }
  if (stat.nlink > 1) {
    throw new Error(`Unsafe generated path is hard-linked: ${filePath}`);
  }
}

export async function openExistingFile(
  root: ContainedRoot,
  parent: DirectoryWitness,
  fileName: string,
  flags = constants.O_RDONLY,
): Promise<ExistingFile> {
  const requestedPath = path.join(parent.path, fileName);
  const anchoredPath = anchoredChildPath(parent, fileName);
  const before = await fs.lstat(requestedPath, { bigint: true });
  const anchoredBefore = await fs.lstat(anchoredPath, { bigint: true });
  assertPlainFileStat(before, requestedPath);
  assertPlainFileStat(anchoredBefore, requestedPath);
  const identity = identityOf(before);
  if (!sameIdentity(identity, anchoredBefore)) {
    throw new Error(`Unsafe generated target changed identity: ${requestedPath}`);
  }
  const resolved = await fs.realpath(requestedPath);
  assertContained(root.realRoot, resolved);
  assertNotRedirected(root, requestedPath, resolved);

  const handle = await fs.open(anchoredPath, flags | NO_FOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || !sameIdentity(identity, opened)
    ) {
      throw new Error(`Unsafe generated target changed identity: ${requestedPath}`);
    }
    const finalPath = await fs.lstat(requestedPath, { bigint: true });
    assertPlainFileStat(finalPath, requestedPath);
    if (!sameIdentity(identity, finalPath)) {
      throw new Error(`Unsafe generated target changed identity: ${requestedPath}`);
    }
    return {
      handle,
      identity,
      mode: Number(opened.mode),
      requestedPath,
      anchoredPath,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function maybeOpenExistingFile(
  root: ContainedRoot,
  parent: DirectoryWitness,
  fileName: string,
): Promise<ExistingFile | undefined> {
  try {
    return await openExistingFile(root, parent, fileName);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function assertFileStillMatches(file: ExistingFile): Promise<void> {
  const opened = await file.handle.stat({ bigint: true });
  const current = await fs.lstat(file.requestedPath, { bigint: true });
  const anchored = await fs.lstat(file.anchoredPath, { bigint: true });
  assertPlainFileStat(current, file.requestedPath);
  assertPlainFileStat(anchored, file.requestedPath);
  if (
    !sameIdentity(file.identity, opened)
    || !sameIdentity(file.identity, current)
    || !sameIdentity(file.identity, anchored)
  ) {
    throw new Error(`Unsafe generated target changed identity: ${file.requestedPath}`);
  }
}

export async function assertTargetAbsent(
  requestedPath: string,
  anchoredPath: string,
): Promise<void> {
  for (const candidate of [requestedPath, anchoredPath]) {
    try {
      await fs.lstat(candidate);
      throw new Error(`Generated target appeared during creation: ${requestedPath}`);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

export async function createContainedRoot(rootPath: string): Promise<ContainedRoot> {
  return createRootDescriptor(rootPath, true);
}

export async function openContainedRoot(rootPath: string): Promise<ContainedRoot> {
  return createRootDescriptor(rootPath, false);
}

export async function ensureContainedDirectory(
  root: ContainedRoot,
  directoryPath: string,
): Promise<string> {
  const segments = relativeSegments(root, directoryPath);
  const witnesses: DirectoryWitness[] = [];
  let current = root.requestedRoot;
  try {
    witnesses.push(await openDirectoryWitness(root, current));
    for (const segment of segments) {
      const parent = witnesses[witnesses.length - 1];
      const next = path.join(current, segment);
      try {
        witnesses.push(await openDirectoryWitness(root, next, parent));
      } catch (error) {
        if (!isNotFound(error)) throw error;
        await validateDirectoryChain(root, witnesses);
        try {
          await fs.mkdir(anchoredChildPath(parent, segment));
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        }
        witnesses.push(await openDirectoryWitness(root, next, parent));
      }
      current = next;
    }
    await validateDirectoryChain(root, witnesses);
    return current;
  } finally {
    await closeDirectoryWitnesses(witnesses);
  }
}

export async function resolveContainedExistingDirectory(
  root: ContainedRoot,
  directoryPath: string,
): Promise<string> {
  const witnesses = await openDirectoryChain(root, directoryPath);
  try {
    await validateDirectoryChain(root, witnesses);
    return path.resolve(directoryPath);
  } finally {
    await closeDirectoryWitnesses(witnesses);
  }
}

export async function readContainedDirectory(
  root: ContainedRoot,
  directoryPath: string,
): Promise<Dirent[]> {
  const witnesses = await openDirectoryChain(root, directoryPath);
  try {
    const directory = witnesses[witnesses.length - 1];
    const entries = await fs.readdir(
      anchoredDirectoryPath(directory),
      { withFileTypes: true },
    );
    await validateDirectoryChain(root, witnesses);
    return entries;
  } finally {
    await closeDirectoryWitnesses(witnesses);
  }
}

export async function resolveContainedFileForWrite(
  root: ContainedRoot,
  filePath: string,
): Promise<string> {
  const segments = relativeSegments(root, filePath);
  if (segments.length === 0) {
    throw new Error(`Generated file path resolves to output root: ${filePath}`);
  }
  const fileName = segments.pop()!;
  const parent = await ensureContainedDirectory(
    root,
    path.join(root.requestedRoot, ...segments),
  );
  return path.join(parent, fileName);
}

export async function resolveContainedExistingFile(
  root: ContainedRoot,
  filePath: string,
): Promise<string> {
  const segments = relativeSegments(root, filePath);
  if (segments.length === 0) {
    throw new Error(`Generated file path resolves to output root: ${filePath}`);
  }
  const fileName = segments.pop()!;
  const parentPath = path.join(root.requestedRoot, ...segments);
  const witnesses = await openDirectoryChain(root, parentPath);
  try {
    const file = await openExistingFile(root, witnesses[witnesses.length - 1], fileName);
    await file.handle.close();
    await validateDirectoryChain(root, witnesses);
    return file.requestedPath;
  } finally {
    await closeDirectoryWitnesses(witnesses);
  }
}

export async function readContainedFile(
  root: ContainedRoot,
  filePath: string,
): Promise<string> {
  const segments = relativeSegments(root, filePath);
  if (segments.length === 0) {
    throw new Error(`Generated file path resolves to output root: ${filePath}`);
  }
  const fileName = segments.pop()!;
  const witnesses = await openDirectoryChain(
    root,
    path.join(root.requestedRoot, ...segments),
  );
  let file: ExistingFile | undefined;
  try {
    file = await openExistingFile(root, witnesses[witnesses.length - 1], fileName);
    const content = await file.handle.readFile("utf-8");
    await validateDirectoryChain(root, witnesses);
    await assertFileStillMatches(file);
    return content;
  } finally {
    await file?.handle.close().catch(() => undefined);
    await closeDirectoryWitnesses(witnesses);
  }
}
