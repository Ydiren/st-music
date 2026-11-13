import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveEntries, readArchiveEntry } from '../zip-archive.js';

// Produced by Python's standard zipfile module, independently of the reader.
// Two distinct entries share a basename; one is stored, one deflated/UTF-8.
const fixture = 'UEsDBBQAAAAAAAAAIVAUW0wOEAAAABAAAAANAAAAb25lL3R1bmUuc25kaHN0b3JlZCB0dW5lIGRhdGFQSwMEFAAACAgAAAAhUE8ICOEYAAAA5AAAABQAAABkZXV4L2NhZsOpL3R1bmUuc25kaEtJTctJLElNUSgpzUtVSEksSVRIGW5CAFBLAQIUAxQAAAAAAAAAIVAUW0wOEAAAABAAAAANAAAAAAAAAAAAAACAAQAAAABvbmUvdHVuZS5zbmRoUEsBAhQDFAAACAgAAAAhUE8ICOEYAAAA5AAAABQAAAAAAAAAAAAAAIABOwAAAGRldXgvY2Fmw6kvdHVuZS5zbmRoUEsFBgAAAAACAAIAfQAAAIUAAAAAAA==';
const capacity = 1024;

async function members(bytes = Buffer.from(fixture, 'base64')) {
  const entries = [];
  for await (const entry of archiveEntries(new Blob([bytes]))) entries.push(entry);
  return entries;
}

test('stored and deflated members retain full UTF-8 names and remain readable after enumeration closes', async () => {
  const entries = await members();
  assert.deepEqual(entries.map(entry => entry.filename), ['one/tune.sndh', 'deux/café/tune.sndh']);
  assert.equal(new TextDecoder().decode(await readArchiveEntry(entries[0], capacity)), 'stored tune data');
  assert.equal(new TextDecoder().decode(await readArchiveEntry(entries[1], capacity)), 'deflated tune data '.repeat(12));
});

test('CRC corruption is rejected instead of feeding damaged music to AtariAudio', async () => {
  const bytes = Buffer.from(fixture, 'base64');
  bytes[bytes.indexOf('stored tune data')] ^= 1;
  const [entry] = await members(bytes);
  await assert.rejects(readArchiveEntry(entry, capacity));
});

test('a member fits at the engine capacity boundary and is rejected above it', async () => {
  const [entry] = await members();
  assert.equal((await readArchiveEntry(entry, entry.uncompressedSize)).length, entry.uncompressedSize);
  await assert.rejects(readArchiveEntry(entry, entry.uncompressedSize - 1));
});

test('a forged size cannot expand beyond the member output allocation', async () => {
  const bytes = Buffer.from(fixture, 'base64');
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(4, 22); // local-header uncompressed size
  bytes.writeUInt32LE(4, central + 24); // central-directory uncompressed size
  const [entry] = await members(bytes);
  await assert.rejects(readArchiveEntry(entry, capacity));
});

test('a truncated archive reports failure rather than an empty collection', async () => {
  await assert.rejects(members(Buffer.from(fixture, 'base64').subarray(0, 80)));
});
