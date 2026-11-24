/**
 * Normalizes a user-entered tool path.
 *
 * People paste paths straight from Explorer's "Copy as path", which wraps the
 * value in double quotes; a quoted absolute path is not a file name, so every
 * detection would report the tool as missing while it sits right there. The
 * same applies to `%ProgramFiles%`-style variables and `~` in hand-written
 * settings, which nobody expands for us.
 */
export function normalizeConfiguredPath(
  value: string | undefined,
  environment: NodeJS.ProcessEnv = process.env
): string {
  if (!value) {
    return '';
  }
  let text = value.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      text = text.slice(1, -1).trim();
    }
  }
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) {
    const home = environment.USERPROFILE ?? environment.HOME ?? '';
    if (home) {
      text = `${home}${text.slice(1)}`;
    }
  }
  return text.replace(/%([^%]+)%/g, (whole: string, name: string) => {
    const expanded = environment[name] ?? environment[name.toUpperCase()];
    return expanded ?? whole;
  });
}
