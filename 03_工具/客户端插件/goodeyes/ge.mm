#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <sys/mman.h>
#include <mach/mach_vm.h>
#include <libkern/OSCacheControl.h>
#include <string>
#include <cstdio>
#include <cstring>
#include <cstdarg>

static uintptr_t g_base=0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
struct VSize{ float w,h; };
typedef void* (*fn0)(void); typedef void* (*fn1)(void*);
typedef void* (*fnSprite)(const std::string*);
typedef void (*fnAdd)(void*,void*,int,int); typedef void (*fnPos)(void*,float,float);
typedef void (*fnScale)(void*,float);        typedef void (*fnOpacity)(void*,unsigned char);
typedef void (*fnVisible)(void*,bool);       typedef void (*fnRun)(void*,void*);
typedef void* (*fnAct1)(float);              typedef void* (*fnSeq)(void*, ...);
typedef void (*fnAction)(void*,void*);

static void L(const char* fmt,...){ FILE*f=fopen("/tmp/pp_ge.log","a"); if(!f)return; va_list a; va_start(a,fmt); vfprintf(f,fmt,a); va_end(a); fputc('\n',f); fclose(f); }

/* ---- 被调用的钩子逻辑（在游戏主线程上执行） ---- */
static int  g_prev_idle = -1;
static int  g_shown = 0;

static void ge_show(void){
    fn0 dirGet=(fn0)S(0x101f8b900);
    fn1 sceneGet=(fn1)S(0x1003a8650);
    fnSprite sprMake=(fnSprite)S(0x101de7280);
    fnAdd addChild=(fnAdd)S(0x101dba310);
    fnPos setPos=(fnPos)S(0x101db8bf0);
    fnScale setScale=(fnScale)S(0x101db8920);
    fnOpacity setOpacity=(fnOpacity)S(0x101dbdc30);
    fnVisible setVisible=(fnVisible)S(0x101db8ee0);
    fnRun runAction=(fnRun)S(0x101dbb840);
    fnAct1 delayCreate=(fnAct1)S(0x101d32cb0);
    fnAct1 fadeCreate=(fnAct1)S(0x101d38370);
    fnSeq seqCreate=(fnSeq)S(0x101d30f40);

    static void* sprite = nullptr;
    if(!sprite){
        std::string n("good_eyes.png");
        sprite = sprMake(&n);
        if(!sprite){ L("[ge] sprite create FAILED"); return; }
        void* d=dirGet(); void* sc = d? sceneGet(d):nullptr;
        if(!sc){ L("[ge] no scene"); sprite=nullptr; return; }
        setPos(sprite, 540.0f, 1250.0f);
        setScale(sprite, 0.18f);   // 原来 0.36，用户要求显示尺寸减半
        addChild(sc, sprite, 10000, 10000);
        L("[ge] sprite created & added");
    }
    setOpacity(sprite, 255);
    setVisible(sprite, true);
    void* dly = delayCreate(1.6f);
    void* fad = fadeCreate(0.5f);
    void* seq = seqCreate(dly, fad, (void*)0);
    if(seq) runAction(sprite, seq);
    g_shown++;
    L("[ge] SHOW #%d", g_shown);
}

extern "C" void ge_on_check(void* self){
    int* p=(int*)self;
    int idle = p[0x54/4] - p[0x50/4];
    L("[ge] check idle=%d prev=%d", idle, g_prev_idle);
    if(g_prev_idle == 1 && idle >= 2) ge_show();
    g_prev_idle = idle;
}

/* ---- 跳板 ---- */
extern "C" uint64_t ge_resume = 0;
extern "C" void ge_entry(void);

__asm__(
".text\n"
".globl _ge_entry\n"
"_ge_entry:\n"
"  pushq %rbx\n"
"  movq %rdi, %rbx\n"
"  callq _ge_on_check\n"
"  movq %rbx, %rdi\n"
"  popq %rbx\n"
"  pushq %rbp\n"
"  movq %rsp, %rbp\n"
"  subq $0x20, %rsp\n"
"  movq %rdi, -0x8(%rbp)\n"
"  movq _ge_resume(%rip), %rax\n"
"  jmpq *%rax\n"
);

static void install(void){
    uintptr_t entry = (uintptr_t)S(0x1002CFE40);
    ge_resume = (uint64_t)S(0x1002CFE4C);
    uintptr_t page = entry & ~0xFFFULL;
    kern_return_t kr = mach_vm_protect(mach_task_self(), page, 0x2000, FALSE,
                                       VM_PROT_READ|VM_PROT_WRITE|VM_PROT_COPY);
    if(kr != KERN_SUCCESS){ L("[ge] vm_protect failed kr=%d", kr); return; }
    unsigned char patch[12] = {0x48,0xB8,0,0,0,0,0,0,0,0,0xFF,0xE0};
    uint64_t tgt=(uint64_t)&ge_entry;
    memcpy(patch+2,&tgt,8);
    memcpy((void*)entry, patch, 12);
    sys_icache_invalidate((void*)entry, 12);
    mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_EXECUTE);
    L("[ge] detour installed at %p -> %p", (void*)entry, (void*)tgt);
}

__attribute__((constructor))
static void on_load(void){
    uint32_t cnt=_dyld_image_count();
    for(uint32_t i=0;i<cnt;i++){
        const char* nm=_dyld_get_image_name(i);
        if(nm && strstr(nm,"MacOS/ParkPassenger")){ g_base=(uintptr_t)_dyld_get_image_header(i); break; }
    }
    L("[ge] loaded base=%p", (void*)g_base);
    if(g_base) install();
}
