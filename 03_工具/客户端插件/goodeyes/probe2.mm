#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#import <dlfcn.h>
#include <cstdio>
__attribute__((constructor))
static void on_load(void){
    FILE* f=fopen("/tmp/pp_show.log","a"); if(!f) return;
    fprintf(f,"header0=%p slide0=%p header1=%p name0=%s\n",
        (void*)_dyld_get_image_header(0), (void*)_dyld_get_image_vmaddr_slide(0),
        (void*)_dyld_get_image_header(1), _dyld_get_image_name(0));
    Dl_info info; if(dladdr((void*)&on_load,&info)) fprintf(f,"dylib base=%p\n",info.dli_fbase);
    fclose(f);
}
