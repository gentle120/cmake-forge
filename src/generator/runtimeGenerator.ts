export const runtimeSourceNames = ['system/syscalls.c', 'system/sysmem.c'] as const;

/** LLVM clang build has no newlib, so the startup arrays need a local runner. */
export const clangRuntimeFileName = 'system/clang_runtime.c';

export function generateClangRuntime(): string {
  return `/* C++/C startup-array runner generated for LLVM clang -nostdlib. */
typedef void (*forge_init_func)(void);

extern forge_init_func __preinit_array_start[] __attribute__((weak));
extern forge_init_func __preinit_array_end[] __attribute__((weak));
extern forge_init_func __init_array_start[] __attribute__((weak));
extern forge_init_func __init_array_end[] __attribute__((weak));

__attribute__((weak)) void __libc_init_array(void)
{
  forge_init_func *function;

  for (function = __preinit_array_start; function < __preinit_array_end; ++function) {
    (*function)();
  }
  for (function = __init_array_start; function < __init_array_end; ++function) {
    (*function)();
  }
}
`;
}


export function generateSyscalls(): string {
  return `/* Minimal newlib system calls generated for bare-metal firmware. */
#include <errno.h>
#include <sys/stat.h>

__attribute__((weak)) int _getpid(void)
{
  return 1;
}

__attribute__((weak)) int _kill(int pid, int sig)
{
  (void)pid;
  (void)sig;
  errno = EINVAL;
  return -1;
}

__attribute__((weak)) void _exit(int status)
{
  (void)status;
  while (1) {
  }
}

__attribute__((weak)) int _read(int file, char *ptr, int len)
{
  (void)file;
  (void)ptr;
  (void)len;
  errno = EAGAIN;
  return -1;
}

__attribute__((weak)) int _write(int file, char *ptr, int len)
{
  (void)file;
  (void)ptr;
  return len;
}

__attribute__((weak)) int _close(int file)
{
  (void)file;
  errno = EBADF;
  return -1;
}

__attribute__((weak)) int _fstat(int file, struct stat *st)
{
  (void)file;
  st->st_mode = S_IFCHR;
  return 0;
}

__attribute__((weak)) int _isatty(int file)
{
  (void)file;
  return 1;
}

__attribute__((weak)) int _lseek(int file, int ptr, int dir)
{
  (void)file;
  (void)ptr;
  (void)dir;
  return 0;
}

__attribute__((weak)) int _open(char *path, int flags, ...)
{
  (void)path;
  (void)flags;
  errno = ENOSYS;
  return -1;
}

__attribute__((weak)) int _unlink(char *name)
{
  (void)name;
  errno = ENOENT;
  return -1;
}

__attribute__((weak)) int _stat(const char *file, struct stat *st)
{
  (void)file;
  st->st_mode = S_IFCHR;
  return 0;
}
`;
}

export function generateSysmem(): string {
  return `/* Heap support generated for bare-metal firmware. */
#include <errno.h>
#include <stddef.h>
#include <stdint.h>

static uint8_t *heap_end;

__attribute__((weak)) void *_sbrk(ptrdiff_t incr)
{
  extern uint8_t _end;
  extern uint8_t _estack;
  extern uint8_t _Min_Stack_Size;
  uint8_t *previous_end;
  const uintptr_t stack_limit = (uintptr_t)&_estack - (uintptr_t)&_Min_Stack_Size;

  if (heap_end == NULL) {
    heap_end = &_end;
  }

  if (incr > 0 && ((uintptr_t)heap_end + (uintptr_t)incr > stack_limit)) {
    errno = ENOMEM;
    return (void *)-1;
  }

  previous_end = heap_end;
  heap_end += incr;
  return previous_end;
}
`;
}
