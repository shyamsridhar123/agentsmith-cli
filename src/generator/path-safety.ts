export {
  assertPortablePathComponents,
  createContainedRoot,
  ensureContainedDirectory,
  openContainedRoot,
  readContainedDirectory,
  readContainedFile,
  resolveContainedExistingDirectory,
  resolveContainedExistingFile,
  resolveContainedFileForWrite,
  type ContainedRoot,
} from "./path-core.js";
export {
  atomicWriteContainedFile,
  removeContainedExistingFile,
} from "./path-mutations.js";
