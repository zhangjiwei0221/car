#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <mach/mach_vm.h>
#include <libkern/OSCacheControl.h>
#include <sys/mman.h>
#include <time.h>
#include <cstdio>
#include <cstring>
#include <initializer_list>

static uintptr_t g_base=0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
static void L(const char* fmt,...){ FILE*f=fopen("/tmp/pp_lose.log","a"); if(!f)return; va_list a; va_start(a,fmt); vfprintf(f,fmt,a); va_end(a); fputc('\n',f); fclose(f); }
static uint64_t ms_now(){ return clock_gettime_nsec_np(CLOCK_UPTIME_RAW)/1000000ULL; }

typedef char (*fn_linked)(void*);
static fn_linked g_linked=nullptr;

extern "C" void lose_log(void* self){
    int* p=(int*)self;
    int idle = p[0x54/4] - p[0x50/4];
    int linked = g_linked ? (g_linked(self)&1) : -1;
    L("[lose] t=%llu idle=%d used=%d cap=%d linked=%d",
      (unsigned long long)(ms_now()%100000000), idle, p[0x50/4], p[0x54/4], linked);
}

static void* g_stub=nullptr;

static bool alloc_stub_near(uintptr_t target){
    for (uintptr_t off : {0x08000000ULL,0x10000000ULL,0x20000000ULL,0x40000000ULL,0x60000000ULL}){
        uintptr_t hint = (target & ~0xFFFULL) + off;
        void* m=mmap((void*)hint, 0x1000, PROT_READ|PROT_WRITE|PROT_EXEC, MAP_ANON|MAP_PRIVATE, -1, 0);
        if(m==MAP_FAILED) continue;
        long long d=(long long)((uintptr_t)m-(long long)target);
        if(d> -0x70000000LL && d< 0x70000000LL){ g_stub=m; return true; }
        munmap(m,0x1000);
    }
    return false;
}

static void patch(void){
    uintptr_t entry=(uintptr_t)S(0x1002EBF10);      // HoldingAreaBoard::_checkGameOver
    uintptr_t resume=entry+11;                       // 跳过 push rbp; mov rbp,rsp; sub rsp,0x110
    g_linked=(fn_linked)S(0x1002E9EA0);              // isLinkedMoveTransactionActive
    if(!alloc_stub_near(entry)){ L("[lose] stub alloc fail"); return; }

    unsigned char code[32] = {
      0x57,                                   // push rdi
      0xE8,0,0,0,0,                           // call lose_log
      0x5F,                                   // pop rdi
      0x55,0x48,0x89,0xE5,                    // push rbp; mov rbp,rsp
      0x48,0x81,0xEC,0x10,0x01,0x00,0x00,     // sub rsp,0x110
      0xE9,0,0,0,0                            // jmp resume（直接相对跳转）
    };
    const size_t N = 22;
    uint32_t callrel=(uint32_t)((uintptr_t)&lose_log - ((uintptr_t)g_stub+6));
    memcpy(&code[2], &callrel, 4);
    int64_t jmprel=(int64_t)resume - (int64_t)((uintptr_t)g_stub + N);
    uint32_t jr=(uint32_t)(int32_t)jmprel;
    memcpy(&code[18], &jr, 4);
    memcpy(g_stub, code, N);
    sys_icache_invalidate(g_stub, N);

    uintptr_t page=entry & ~0xFFFULL;
    kern_return_t kr=mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_WRITE|VM_PROT_COPY);
    if(kr!=KERN_SUCCESS){ L("[lose] protect fail %d", kr); return; }
    unsigned char jmp5[5]={0xE9,0,0,0,0};
    uint32_t rel=(uint32_t)((uintptr_t)g_stub - (entry+5));
    memcpy(&jmp5[1], &rel, 4);
    memcpy((void*)entry, jmp5, 5);
    sys_icache_invalidate((void*)entry, 5);
    mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_EXECUTE);
    L("[lose] hook ok entry=%p stub=%p", (void*)entry, g_stub);
}

__attribute__((constructor)) static void on_load(void){
    uint32_t c=_dyld_image_count();
    for(uint32_t i=0;i<c;i++){ const char* nm=_dyld_get_image_name(i);
        if(nm&&strstr(nm,"MacOS/ParkPassenger")){ g_base=(uintptr_t)_dyld_get_image_header(i); break; } }
    if(!g_base){ L("[lose] base not found"); return; }
    L("[lose] loaded base=%p",(void*)g_base);
    patch();
}
