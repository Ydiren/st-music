import { copyFile, mkdir } from 'node:fs/promises';

const generated = new URL('../generated/', import.meta.url);
await mkdir(generated, { recursive: true });
// Self-contained ESM with native decompression plus a bundled JS fallback.
await copyFile(
  new URL('../node_modules/@zip.js/zip.js/index-native.min.js', import.meta.url),
  new URL('zip.js', generated),
);
await copyFile(
  new URL('../node_modules/@zip.js/zip.js/LICENSE', import.meta.url),
  new URL('zip-LICENSE.txt', generated),
);
await copyFile(
  new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url),
  new URL('THIRD_PARTY_NOTICES.txt', generated),
);
