import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const revision = '5fd4b46b1a2a8fa776f8f0f68f648ef70c03ef10';
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
try {
  await readdir('vendor/AtariAudio/src');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  run('git', ['clone', 'https://github.com/arnaud-carre/AtariAudio.git', 'vendor/AtariAudio']);
  run('git', ['-C', 'vendor/AtariAudio', 'checkout', '--detach', revision]);
}
const version = spawnSync('git', ['-C', 'vendor/AtariAudio', 'rev-parse', 'HEAD'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== revision) {
  throw new Error(`Expected AtariAudio revision ${revision}; refusing an unpinned build.`);
}
async function sources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sources(name));
    else if (name.endsWith('.cpp')) files.push(name);
  }
  return files;
}
await import('./zip-assets.mjs');
run(process.env.EMXX || 'em++', [
  'native/bridge.cpp', ...await sources('vendor/AtariAudio/src'),
  '-Ivendor/AtariAudio/src', '-std=c++17', '-O3', '-DNDEBUG',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=worker,worklet',
  '-sINCOMING_MODULE_JS_API=["wasmBinary"]',
  '-sINITIAL_MEMORY=67108864', '-sALLOW_MEMORY_GROWTH=0',
  '-sEXPORTED_FUNCTIONS=["_malloc","_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","HEAP16"]',
  '-o', 'generated/atari-audio.js',
]);
console.log(`Built AtariAudio ${revision} → generated/atari-audio.{js,wasm}`);
