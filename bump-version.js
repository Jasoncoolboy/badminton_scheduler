#!/usr/bin/env node
// Bumps the app version everywhere it appears, so a release can never ship
// with mismatched version strings (which is what leaves devices on old code).
//
//   node bump-version.js 2.4.0     set an exact version
//   node bump-version.js patch     2.3.0 -> 2.3.1
//   node bump-version.js minor     2.3.0 -> 2.4.0
//   node bump-version.js major     2.3.0 -> 3.0.0
//   node bump-version.js           show the current version

const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, text) => fs.writeFileSync(path.join(root, file), text);

const current = JSON.parse(read('version.json')).version;

const arg = process.argv[2];
if (!arg) {
    console.log(`current version: ${current}`);
    process.exit(0);
}

function next(from, kind) {
    const [major, minor, patch] = from.split('.').map(Number);
    if (kind === 'major') return `${major + 1}.0.0`;
    if (kind === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

const version = /^\d+\.\d+\.\d+$/.test(arg) ? arg : next(current, arg);
if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`Not a version or bump kind: ${arg}`);
    process.exit(1);
}

// sw.js also carries SW_VERSION, bumped separately only if its own logic changes
const edits = [
    ['version.json', /"version":\s*"[^"]+"/, `"version": "${version}"`],
    ['app.js', /const APP_VERSION = '[^']+'/, `const APP_VERSION = '${version}'`],
    ['sw.js', /const APP_VERSION = '[^']+'/, `const APP_VERSION = '${version}'`],
    ['index.html', /\?v=\d+\.\d+\.\d+/g, `?v=${version}`],
    ['index.html', /(id="version-label"[^>]*>)v[^<]*/, `$1v${version}`]
];

for (const [file, pattern, replacement] of edits) {
    const before = read(file);
    const after = before.replace(pattern, replacement);
    if (before === after) {
        console.error(`WARNING: nothing matched ${pattern} in ${file}`);
        continue;
    }
    write(file, after);
}

console.log(`${current} -> ${version}`);
console.log('Now commit and push; devices pick it up on next launch.');
