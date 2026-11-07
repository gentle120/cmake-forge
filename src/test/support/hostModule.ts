import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { runInNewContext } from 'node:vm';

/** Loads adjacent host adapters with one isolated VS Code API fixture. */
export function loadHostModule<T>(filename: string, vscode: object): T {
  const directory = dirname(filename);
  const modules = new Map<string, { exports: unknown }>();
  const load = (file: string): unknown => {
    const cached = modules.get(file);
    if (cached) {
      return cached.exports;
    }
    const moduleObject = { exports: {} as unknown };
    modules.set(file, moduleObject);
    const requireFile = createRequire(file);
    const wrapper = runInNewContext(
      '(function(require, module, exports, __filename, __dirname) {\n' + readFileSync(file, 'utf8') + '\n})',
      { AbortController, console }
    );
    wrapper((name: string) => {
      if (name === 'vscode') {
        return vscode;
      }
      const resolved = requireFile.resolve(name);
      return dirname(resolved) === directory ? load(resolved) : requireFile(name);
    }, moduleObject, moduleObject.exports, file, dirname(file));
    return moduleObject.exports;
  };
  return load(filename) as T;
}
