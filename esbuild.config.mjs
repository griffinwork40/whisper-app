import { build } from 'esbuild';
import { readdirSync, statSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedOptions = {
  platform: 'node',
  target: 'node22',
  external: ['electron', 'uiohook-napi'],
  format: 'cjs',
  bundle: true,
  sourcemap: false,
};

// Build main entry point (only if it exists)
const mainEntry = path.join(__dirname, 'src', 'main.ts');
if (existsSync(mainEntry)) {
  await build({
    ...sharedOptions,
    entryPoints: ['src/main.ts'],
    outfile: 'dist/main.js',
  });
  console.log('Built: dist/main.js');
} else {
  console.log('Skipping dist/main.js — src/main.ts not yet created.');
}

// Build test files
function findTestFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        results.push(...findTestFiles(fullPath));
      } else if (entry.endsWith('.test.ts')) {
        results.push(fullPath);
      }
    }
  } catch {
    // test dir may not exist yet
  }
  return results;
}

const testFiles = findTestFiles(path.join(__dirname, 'test'));
if (testFiles.length > 0) {
  await build({
    ...sharedOptions,
    entryPoints: testFiles,
    outdir: 'dist/test',
    outbase: 'test',
  });
  console.log(`Built ${testFiles.length} test file(s) to dist/test/`);
}

// Copy sound assets to dist/sounds/ if they exist
const soundsSrc = path.join(__dirname, 'assets', 'sounds');
const soundsDst = path.join(__dirname, 'dist', 'sounds');
if (existsSync(soundsSrc)) {
  mkdirSync(soundsDst, { recursive: true });
  cpSync(soundsSrc, soundsDst, { recursive: true });
  console.log('Copied assets/sounds → dist/sounds/');
} else {
  console.log('Skipping sound copy — assets/sounds/ not yet present.');
}

console.log('Build complete.');
