import { BlobReader, ZipReader } from './generated/zip.js';

export async function* archiveEntries(file) {
  // BlobReader uses byte ranges; it does not buffer the entire archive.
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    yield* reader.getEntriesGenerator();
  } finally {
    // Entry readers retain their Blob reference and remain readable after close.
    await reader.close();
  }
}

export async function readArchiveEntry(entry, capacity) {
  if (entry.encrypted) throw new Error('Password-protected ZIP entries are not supported.');
  const size = entry.uncompressedSize;
  // A song larger than the entire fixed WASM memory cannot be loaded. Check
  // before allocating, and bound actual output too (ZIP headers are untrusted).
  if (!Number.isSafeInteger(size) || size < 0 || size > capacity) {
    throw new Error('ZIP entry exceeds the audio engine memory capacity.');
  }
  const bytes = new Uint8Array(size);
  let written = 0;
  await entry.getData(new WritableStream({
    write(chunk) {
      if (chunk.length > size - written) throw new Error('ZIP entry size does not match its directory record.');
      bytes.set(chunk, written);
      written += chunk.length;
    },
  }), { useWebWorkers: false, checkSignature: true });
  if (written !== size) throw new Error('ZIP entry size does not match its directory record.');
  return bytes;
}
