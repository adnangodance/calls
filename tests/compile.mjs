import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

// Compile the real UI modules, retaining ordinary imports of shared JS and data.
export async function loadSource(entry) {
  const sources = ['App.tsx', 'PracticePage.tsx', 'Stats.tsx', 'practice-client.ts', 'practice-progress.ts', 'MicrophoneCheck.tsx', 'microphone-check.ts'];
  const paths = new Map(sources.map(name => [name.replace(/\.tsx?$/, ''), resolve(`src/.test-${process.pid}-${name.replace(/\.tsx?$/, '')}.mjs`)]));
  try {
    for (const name of sources) {
      const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
        .replaceAll('import.meta.env.BASE_URL', JSON.stringify('/calls/'))
        .replaceAll('import.meta.env.VITE_PRACTICE_API_URL', JSON.stringify(''))
        .replace(/from ['"]\.\/calls\.json['"];/, "from './calls.json' with { type: 'json' };")
        .replace(/from ['"]\.\/(PracticePage|Stats|practice-client|practice-progress|MicrophoneCheck|microphone-check)['"]/g, (_, name) => `from '${pathToFileURL(paths.get(name)).href}'`);
      await writeFile(paths.get(name.replace(/\.tsx?$/, '')), compiled);
    }
    return await import(pathToFileURL(paths.get(entry)).href);
  } finally { await Promise.all([...paths.values()].map(path => unlink(path).catch(() => {}))); }
}
