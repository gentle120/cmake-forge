/**
 * Directory and file-extension rules shared by the two workspace scanners.
 *
 * Both the source scanner and the project discovery walk the same tree, so the
 * exclusion rules live here: two hand-maintained copies had already started to
 * drift, and a divergence makes discovery and scanning disagree about which
 * directories belong to a project.
 */

/** Directories that never contain hand-written project sources. */
export const ignoredDirectories = new Set([
  '.git',
  '.vscode',
  '.cmsis',
  '.eide',
  '.pack',
  '.cache',
  'build',
  'CMakeFiles',
  'cmake-build-debug',
  'cmake-build-release',
  'cmake',
  '_cmake',
  'node_modules',
  'out',
  'objects',
  'listings'
]);

/** Extensions counted as compilable C/C++/assembly sources. */
export const sourceExtensions = new Set(['.c', '.cc', '.cpp', '.cxx', '.s']);

/** Extensions counted as C/C++ headers. */
export const headerExtensions = new Set(['.h', '.hh', '.hpp', '.hxx']);
