export type NativeTargetType = 'executable' | 'static' | 'shared';

/** Compiler commands of the selected host toolchain. */
export interface NativeToolchain {
  cCompiler: string;
  cxxCompiler?: string;
}

export interface NativeProjectStructure {
  sources: string[];
  includeDirs: string[];
  defines: string[];
  targetName: string;
  targetType: NativeTargetType;
  cStandard: number;
  cxxStandard: number;
  /** Empty means CMake's own compiler detection. */
  toolchain?: NativeToolchain;
}

export const nativeConfigFileName = '.native-cmake.json';
