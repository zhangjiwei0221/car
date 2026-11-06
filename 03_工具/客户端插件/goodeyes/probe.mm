#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <stdio.h>

__attribute__((constructor))
static void on_load(void) {
    FILE *f = fopen("/tmp/pp_inject_probe.txt", "a");
    if (f) { fprintf(f, "loaded pid=%d slide=%p\n", getpid(), (void*)_dyld_get_image_vmaddr_slide(0)); fclose(f); }
}
