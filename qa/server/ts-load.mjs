// Loads one of the site's TypeScript files in Node for unit tests (TypeScript's own transpiler, no bundler).
// Only for files without runtime imports (engine.ts, classic.ts, lab.ts).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const ts = require('../../node_modules/typescript');

export const loadTs = async (file) => {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kapa-ts-'));
    const f = path.join(dir, path.basename(file).replace(/\.tsx?$/, '.mjs'));
    fs.writeFileSync(f, out);
    return import(pathToFileURL(f).href);
};
