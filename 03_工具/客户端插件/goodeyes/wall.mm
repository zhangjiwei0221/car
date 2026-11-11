#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <mach/mach_vm.h>
#include <libkern/OSCacheControl.h>
#include <cstdio>
#include <cstring>

static uintptr_t g_base=0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
static void L(const char* fmt,...){ FILE*f=fopen("/tmp/pp_wall.log","a"); if(!f)return; va_list a; va_start(a,fmt); vfprintf(f,fmt,a); va_end(a); fputc('\n',f); fclose(f); }

static void poke(uint64_t va, unsigned char val){
    uintptr_t p=(uintptr_t)S(va); uintptr_t page=p & ~0xFFFULL;
    kern_return_t kr=mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_WRITE|VM_PROT_COPY);
    if(kr!=KERN_SUCCESS){ L("protect fail %p kr=%d",(void*)p,kr); return; }
    unsigned char old=*(unsigned char*)p;
    *(unsigned char*)p = val;
    sys_icache_invalidate((void*)p,1);
    mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_EXECUTE);
    L("patch %p: %02x -> %02x", (void*)p, old, val);
}

__attribute__((constructor)) static void on_load(void){
    uint32_t c=_dyld_image_count();
    for(uint32_t i=0;i<c;i++){ const char* nm=_dyld_get_image_name(i);
        if(nm&&strstr(nm,"MacOS/ParkPassenger")){ g_base=(uintptr_t)_dyld_get_image_header(i); break; } }
    if(!g_base){ L("base not found"); return; }
    L("loaded base=%p",(void*)g_base);
    /* _canBlockReachExit：上/左/右越界不再算出口（下越界保留） */
    poke(0x10030CCA6, 0x00);   /* nr >= rows  -> false */
    poke(0x10030CCAA, 0x00);   /* nc < 0      -> 默认 false */
    poke(0x10030CCB8, 0x00);   /* nc >= cols  -> 默认 false */
    /* _buildExitPathMap：只在底边(nr==0)播种出口 */
    /* 行号在 -0x8c，列号在 -0x90 */
    poke(0x10030C782, 0x00);   /* row == 0   = 底边：保留（出口） */
    poke(0x10030C793, 0xFF);   /* col == 0   = 左边：关掉 */
    poke(0x10030C7A7, 0x00);   /* col == cols-1 = 右边：关掉 */
    poke(0x10030C7BF, 0x00);   /* row == rows-1 = 顶边：关掉 */
}
