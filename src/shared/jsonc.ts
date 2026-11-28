/**
 * Minimal JSONC support for the VS Code files the extension edits.
 *
 * `settings.json`, `launch.json` and `c_cpp_properties.json` are JSONC: users
 * legitimately leave `//` notes and trailing commas in them. `JSON.parse` on the
 * raw text rejects those files, so every reader strips comments and trailing
 * commas first, leaving string literals untouched.
 */

/** Removes `//` and block comments, keeping string contents byte-for-byte. */
export function stripJsonComments(source: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === '/' && next === '/') {
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== '\n') {
        index += 1;
      }
      result += '\n';
    } else if (character === '/' && next === '*') {
      index += 2;
      while (index + 1 < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      result += ' ';
    } else {
      result += character;
    }
  }
  return result;
}

/** Removes commas that directly precede `}` or `]`, keeping strings untouched. */
export function stripTrailingCommas(source: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ',') {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? '')) {
        lookahead += 1;
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        continue;
      }
    }
    result += character;
  }
  return result;
}

/**
 * Parses JSONC text. `label` names the file in the error message so a broken
 * document points at the file the user has to fix.
 */
export function parseJsoncText(source: string, label: string): unknown {
  try {
    return JSON.parse(stripTrailingCommas(stripJsonComments(source)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${label}: ${message}`);
  }
}
