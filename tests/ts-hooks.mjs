import ts from 'typescript';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  const { parentURL } = context;

  // Intercept child process spawning to enforce allowlisted environment and test isolation
  const ISOLATED_CP_URL = new URL("./isolated-child-process.mjs", import.meta.url).href;
  if (
    (specifier === "node:child_process" || specifier === "child_process") &&
    parentURL !== ISOLATED_CP_URL
  ) {
    return {
      url: ISOLATED_CP_URL,
      shortCircuit: true,
    };
  }

  if (parentURL && (specifier.startsWith('./') || specifier.startsWith('../'))) {
    try {
      const parentPath = fileURLToPath(parentURL);
      const dir = path.dirname(parentPath);
      const resolvedPath = path.resolve(dir, specifier);
      const extensions = ['.tsx', '.ts', '.jsx', '.js'];
      for (const ext of extensions) {
        const candidate = resolvedPath + ext;
        if (fs.existsSync(candidate)) {
          return {
            url: pathToFileURL(candidate).href,
            shortCircuit: true
          };
        }
      }
    } catch {
      // Fall through to nextResolve
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = new URL(url);
    const source = fs.readFileSync(filePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    });
    return {
      format: 'module',
      shortCircuit: true,
      source: outputText
    };
  }
  return nextLoad(url, context);
}
