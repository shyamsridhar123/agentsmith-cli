import fs from "fs/promises";
import type { Stats } from "fs";
import path from "path";
import { createHash } from "node:crypto";

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|py|go)$/i;

const TEST_OR_FIXTURE_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "fixture",
  "fixtures",
  "__fixtures__",
  "testdata",
  "__mocks__",
]);

const GENERATED_OR_VENDOR_SEGMENTS = new Set([
  "dist",
  "build",
  "coverage",
  "generated",
  "__generated__",
  "vendor",
  "node_modules",
]);

const SENSITIVE_DIRECTORY_SEGMENTS = new Set([
  "secret",
  "secrets",
  ".secrets",
  ".aws",
  ".azure",
  ".docker",
  ".gnupg",
  ".kube",
  ".ssh",
  ".terraform.d",
]);

const SENSITIVE_CONFIG_CHILDREN = new Set([
  "aws",
  "azure",
  "docker",
  "gcloud",
  "gh",
  "hub",
  "kube",
]);

const SENSITIVE_BASENAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "credentials.json",
  "secrets.json",
  "token.json",
  "service-account.json",
  "application_default_credentials.json",
]);

const SECRET_DATA_FILE_PATTERN =
  /(?:^|[._-])(?:credential|credentials|secret|secrets|token|tokens|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|service[-_]?account[-_]?key)\.(?:json|ya?ml|toml|ini|conf|txt)$/i;

export interface SafeRepositoryFile {
  path: string;
  size: number;
}

export interface RepositorySnapshotFile {
  readonly path: string;
  readonly relativePath: string;
  readonly size: number;
  readonly digest?: string;
  readonly text?: string;
  readonly textTruncated: boolean;
}

export interface RepositorySnapshot {
  readonly rootPath: string;
  readonly files: ReadonlyMap<string, RepositorySnapshotFile>;
}

export interface RepositoryFileSnapshotOptions {
  computeDigest?: boolean;
  textByteLimit?: number;
}

export interface RepositorySnapshotOptions {
  computeDigests?: boolean;
  textByteLimits?: ReadonlyMap<string, number>;
}

class ImmutableMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;

  constructor(values: Map<K, V>) {
    this.#values = values;
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  keys(): MapIterator<K> {
    return this.#values.keys();
  }

  values(): MapIterator<V> {
    return this.#values.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    this.#values.forEach((value, key) => {
      callbackfn.call(thisArg, value, key, this);
    });
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }
}

export function normalizeRepositoryPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}

function repositorySegments(filePath: string): string[] {
  return normalizeRepositoryPath(filePath)
    .toLowerCase()
    .split("/")
    .filter(Boolean);
}

export function isSensitiveRepositoryPath(filePath: string): boolean {
  const normalized = normalizeRepositoryPath(filePath).toLowerCase();
  const segments = repositorySegments(normalized);
  const basename = segments.at(-1) ?? "";
  const configIndex = segments.lastIndexOf(".config");

  return (
    segments.some((segment) => SENSITIVE_DIRECTORY_SEGMENTS.has(segment)) ||
    (
      configIndex >= 0 &&
      SENSITIVE_CONFIG_CHILDREN.has(segments[configIndex + 1] ?? "")
    ) ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === ".envrc" ||
    SENSITIVE_BASENAMES.has(basename) ||
    SECRET_DATA_FILE_PATTERN.test(basename) ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(basename) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(basename)
  );
}

export function isGeneratedRepositoryPath(filePath: string): boolean {
  const normalized = normalizeRepositoryPath(filePath);
  const segments = repositorySegments(normalized);

  return (
    segments.some((segment) => GENERATED_OR_VENDOR_SEGMENTS.has(segment)) ||
    /^\.github\/(?:agents|skills|copilot|hooks)(\/|$)/i.test(normalized) ||
    /(^|\/)skills-registry\.jsonl$/i.test(normalized) ||
    /(^|\/)\.copilot-instructions\.md$/i.test(normalized) ||
    /\.(?:generated|gen)\.[^/]+$/i.test(normalized)
  );
}

export function isTestOrFixturePath(filePath: string): boolean {
  const normalized = normalizeRepositoryPath(filePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  const segments = repositorySegments(normalized);

  return (
    segments.some((segment) => TEST_OR_FIXTURE_SEGMENTS.has(segment)) ||
    /\.(?:test|spec)\.[^/]+$/i.test(basename) ||
    /_test\.[^/]+$/i.test(basename) ||
    /^test_[^/]+\.[^/]+$/i.test(basename)
  );
}

export function isCLIImplementationPath(filePath: string): boolean {
  const normalized = normalizeRepositoryPath(filePath);
  return (
    SOURCE_EXTENSIONS.test(normalized) &&
    !isTestOrFixturePath(normalized) &&
    !isGeneratedRepositoryPath(normalized) &&
    !isSensitiveRepositoryPath(normalized)
  );
}

function comparisonPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isContainedPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unchangedDuringRead(before: Stats, after: Stats): boolean {
  return (
    sameFileIdentity(before, after) &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    after.nlink <= 1
  );
}

function isUnsafeHardLink(stat: Stats): boolean {
  return stat.nlink > 1;
}

function isSafeRelativePath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !path.posix.isAbsolute(relativePath) &&
    !relativePath.split("/").some((segment) => segment === "..")
  );
}

async function assertNoLinkedComponents(
  canonicalRoot: string,
  fullPath: string,
): Promise<boolean> {
  const relativePath = path.relative(canonicalRoot, fullPath);
  let current = canonicalRoot;

  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const linkStat = await fs.lstat(current);
    if (linkStat.isSymbolicLink()) return false;

    const resolvedComponent = await fs.realpath(current);
    if (comparisonPath(resolvedComponent) !== comparisonPath(current)) {
      return false;
    }
  }

  return true;
}

export async function resolveSafeRepositoryFile(
  rootPath: string,
  relativePath: string,
): Promise<SafeRepositoryFile | undefined> {
  const normalized = normalizeRepositoryPath(relativePath);
  if (!isSafeRelativePath(normalized)) return undefined;

  try {
    const canonicalRoot = await fs.realpath(rootPath);
    const lexicalPath = path.resolve(rootPath, ...normalized.split("/"));
    const expectedPath = path.resolve(canonicalRoot, ...normalized.split("/"));
    if (!isContainedPath(canonicalRoot, expectedPath)) return undefined;

    const stat = await fs.lstat(lexicalPath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      isUnsafeHardLink(stat)
    ) {
      return undefined;
    }

    const canonicalFile = await fs.realpath(lexicalPath);
    if (
      !isContainedPath(canonicalRoot, canonicalFile) ||
      comparisonPath(canonicalFile) !== comparisonPath(expectedPath)
    ) {
      return undefined;
    }

    return { path: canonicalFile, size: stat.size };
  } catch {
    return undefined;
  }
}

export async function snapshotRepositoryFile(
  rootPath: string,
  relativePath: string,
  options: RepositoryFileSnapshotOptions = {},
): Promise<RepositorySnapshotFile | undefined> {
  const normalized = normalizeRepositoryPath(relativePath);
  if (!isSafeRelativePath(normalized)) return undefined;
  const computeDigest = options.computeDigest ?? true;
  const textByteLimit = options.textByteLimit === undefined
    ? undefined
    : Math.max(0, Math.floor(options.textByteLimit));

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const canonicalRoot = await fs.realpath(rootPath);
    const fullPath = path.resolve(canonicalRoot, ...normalized.split("/"));
    if (!isContainedPath(canonicalRoot, fullPath)) return undefined;

    // Open first. Every path-based check below is bound back to this handle.
    handle = await fs.open(fullPath, "r");
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      isUnsafeHardLink(openedStat)
    ) {
      return undefined;
    }

    if (!await assertNoLinkedComponents(canonicalRoot, fullPath)) {
      return undefined;
    }

    const pathStat = await fs.lstat(fullPath);
    if (
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      isUnsafeHardLink(pathStat) ||
      !sameFileIdentity(openedStat, pathStat)
    ) {
      return undefined;
    }

    const canonicalFile = await fs.realpath(fullPath);
    if (
      !isContainedPath(canonicalRoot, canonicalFile) ||
      comparisonPath(canonicalFile) !== comparisonPath(fullPath)
    ) {
      return undefined;
    }

    const canonicalStat = await fs.stat(canonicalFile);
    if (
      !canonicalStat.isFile() ||
      isUnsafeHardLink(canonicalStat) ||
      !sameFileIdentity(openedStat, canonicalStat)
    ) {
      return undefined;
    }

    const digest = computeDigest ? createHash("sha256") : undefined;
    const textChunks: Buffer[] = [];
    let textBytes = 0;
    let position = 0;
    const chunk = Buffer.allocUnsafe(64 * 1024);

    while (
      computeDigest ||
      (textByteLimit !== undefined && textBytes < textByteLimit)
    ) {
      const remainingText = textByteLimit === undefined
        ? 0
        : textByteLimit - textBytes;
      const readLength = computeDigest
        ? chunk.byteLength
        : Math.min(chunk.byteLength, remainingText);
      if (readLength <= 0) break;

      const { bytesRead } = await handle.read(
        chunk,
        0,
        readLength,
        position,
      );
      if (bytesRead === 0) break;
      const bytes = chunk.subarray(0, bytesRead);
      digest?.update(bytes);

      if (textByteLimit !== undefined && textBytes < textByteLimit) {
        const capturedBytes = Math.min(bytesRead, textByteLimit - textBytes);
        if (capturedBytes > 0) {
          textChunks.push(Buffer.from(bytes.subarray(0, capturedBytes)));
          textBytes += capturedBytes;
        }
      }
      position += bytesRead;
    }

    const finalStat = await handle.stat();
    if (!unchangedDuringRead(openedStat, finalStat)) {
      return undefined;
    }

    const text = textByteLimit === undefined
      ? undefined
      : Buffer.concat(textChunks, textBytes).toString("utf-8");
    return Object.freeze({
      path: canonicalFile,
      relativePath: normalized,
      size: openedStat.size,
      digest: digest?.digest("hex"),
      text,
      textTruncated: textByteLimit !== undefined && openedStat.size > textBytes,
    });
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function createRepositorySnapshot(
  rootPath: string,
  relativePaths: Iterable<string>,
  options: RepositorySnapshotOptions = {},
): Promise<RepositorySnapshot> {
  const canonicalRoot = await fs.realpath(rootPath);
  const files = new Map<string, RepositorySnapshotFile>();
  const computeDigests = options.computeDigests ?? true;
  const textByteLimits = new Map(
    Array.from(options.textByteLimits ?? [], ([filePath, limit]) => [
      normalizeRepositoryPath(filePath),
      limit,
    ]),
  );
  const paths = Array.from(
    new Set(Array.from(relativePaths, normalizeRepositoryPath)),
  ).sort((left, right) => left.localeCompare(right));

  for (const relativePath of paths) {
    const file = await snapshotRepositoryFile(canonicalRoot, relativePath, {
      computeDigest: computeDigests,
      textByteLimit: textByteLimits.get(relativePath),
    });
    if (file) files.set(file.relativePath, file);
  }

  return Object.freeze({
    rootPath: canonicalRoot,
    files: new ImmutableMapView(files),
  });
}

export async function readSafeRepositoryFile(
  rootPath: string,
  relativePath: string,
  maxBytes = 1024 * 1024,
): Promise<string | undefined> {
  return (await snapshotRepositoryFile(rootPath, relativePath, {
    computeDigest: false,
    textByteLimit: maxBytes,
  }))?.text;
}
