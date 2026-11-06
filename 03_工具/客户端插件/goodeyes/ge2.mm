#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <mach/mach_vm.h>
#include <libkern/OSCacheControl.h>
#include <time.h>
#include <string>
#include <cstdio>
#include <cstring>
#include <cstdarg>

static uintptr_t g_base=0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
typedef void* (*fn0)(void); typedef void* (*fn1)(void*);
typedef void* (*fnSprite)(const std::string*);
typedef void (*fnAdd)(void*,void*,int,int); typedef void (*fnPos)(void*,float,float);
typedef void (*fnScale)(void*,float);        typedef void (*fnOpacity)(void*,unsigned char);
typedef void (*fnVisible)(void*,bool);       typedef void (*fnRun)(void*,void*);
typedef void* (*fnAct1)(float);              typedef void* (*fnSeq)(void*, ...);

static void L(const char* fmt,...){ FILE*f=fopen("/tmp/pp_ge.log","a"); if(!f)return; va_list a; va_start(a,fmt); vfprintf(f,fmt,a); va_end(a); fputc('\n',f); fclose(f); }
static uint64_t now_ms(){ return clock_gettime_nsec_np(CLOCK_UPTIME_RAW)/1000000ULL; }

static uint64_t g_t4 = 0, g_armed_ms = 0;
static int g_prev_idle = -1, g_prev_occ = -1, g_shown = 0, g_armed = 0, g_ready = 0;

static void ge_show(void){
    fn0 dirGet=(fn0)S(0x101f8b900); fn1 sceneGet=(fn1)S(0x1003a8650);
    fnSprite sprMake=(fnSprite)S(0x101de7280); fnAdd addChild=(fnAdd)S(0x101dba310);
    fnPos setPos=(fnPos)S(0x101db8bf0); fnScale setScale=(fnScale)S(0x101db8920);
    fnOpacity setOpacity=(fnOpacity)S(0x101dbdc30); fnVisible setVisible=(fnVisible)S(0x101db8ee0);
    fnRun runAction=(fnRun)S(0x101dbb840);
    fnAct1 delayCreate=(fnAct1)S(0x101d32cb0); fnAct1 fadeCreate=(fnAct1)S(0x101d38370);
    fnSeq seqCreate=(fnSeq)S(0x101d30f40);
    static void* sprite=nullptr;
    if(!sprite){
        std::string n("good_eyes.png"); sprite=sprMake(&n);
        if(!sprite){ L("[ge] sprite FAILED"); return; }
        void* d=dirGet(); void* sc=d?sceneGet(d):nullptr; if(!sc){ sprite=nullptr; return; }
        setPos(sprite,540.0f,1250.0f); setScale(sprite,0.18f);
        addChild(sc,sprite,10000,10000); L("[ge] sprite added");
    }
    setOpacity(sprite,255); setVisible(sprite,true);
    void* dly=delayCreate(1.6f); void* fad=fadeCreate(0.5f);
    void* seq=seqCreate(dly,fad,(void*)0); if(seq) runAction(sprite,seq);
    L("[ge] SHOW #%d", ++g_shown);
}

extern "C" void ge_on_check(void* self){
    int* p=(int*)self;
    int occ = p[0x50/4];
    uint64_t now = now_ms();

    /* ① 占用停在 4、2 秒没变化 → “静置满” */
    if(occ == 4){
        if(g_prev_occ != 4) g_t4 = now;
        if(!g_ready && now - g_t4 >= 2000){ g_ready = 1; L("[ge] READY (4 静置 2s)"); }
    } else if(occ != 5){
        g_ready = 0;
    }

    /* ② 静置满之后放第 5 辆：4 -> 5 */
    if(g_prev_occ == 4 && occ == 5){
        if(g_ready){ g_armed = 1; g_armed_ms = now; g_ready = 0; L("[ge] ARMED (4->5)"); }
        else L("[ge] 4->5 but not READY");
    }

    /* ③ 放车后 3 秒内：没再放车 + 占用掉到 4 以下 → 触发 */
    if(g_armed){
        if(g_prev_occ >= 0 && occ > g_prev_occ){
            L("[ge] disarm (another placement)"); g_armed = 0;
        } else if(occ < 4){
            L("[ge] TRIGGER 5->%d after=%llums", occ, (unsigned long long)(now-g_armed_ms));
            ge_show(); g_armed = 0;
        } else if(now - g_armed_ms > 3000){
            L("[ge] disarm (3s timeout)"); g_armed = 0;
        }
    }

    g_prev_occ = occ;
}

extern "C" uint64_t ge_resume_a=0;
extern "C" void ge_entry_a(void);   /* 挂在 checkSlotsWarnning */

__asm__(
".text\n"
".globl _ge_entry_a\n"
"_ge_entry_a:\n"
"  pushq %rbx\n  movq %rdi, %rbx\n  callq _ge_on_check\n  movq %rbx, %rdi\n  popq %rbx\n"
"  pushq %rbp\n  movq %rsp, %rbp\n  subq $0x20, %rsp\n  movq %rdi, -0x8(%rbp)\n"
"  movq _ge_resume_a(%rip), %rax\n  jmpq *%rax\n"
);

static void detour(uint64_t va, void* hook, uint64_t resume_va, const char* tag){
    uintptr_t entry=(uintptr_t)S(va);
    uintptr_t page=entry & ~0xFFFULL;
    kern_return_t kr=mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_WRITE|VM_PROT_COPY);
    if(kr!=KERN_SUCCESS){ L("[ge] %s vm_protect failed %d", tag, kr); return; }
    unsigned char patch[12]={0x48,0xB8,0,0,0,0,0,0,0,0,0xFF,0xE0};
    uint64_t tgt=(uint64_t)hook; memcpy(patch+2,&tgt,8);
    memcpy((void*)entry,patch,12); sys_icache_invalidate((void*)entry,12);
    mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_EXECUTE);
    L("[ge] %s detour %p -> %p", tag, (void*)entry, hook);
}

__attribute__((constructor))
static void on_load(void){
    uint32_t cnt=_dyld_image_count();
    for(uint32_t i=0;i<cnt;i++){ const char* nm=_dyld_get_image_name(i);
        if(nm && strstr(nm,"MacOS/ParkPassenger")){ g_base=(uintptr_t)_dyld_get_image_header(i); break; } }
    L("[ge] loaded base=%p", (void*)g_base);
    if(!g_base) return;
    ge_resume_a=(uint64_t)S(0x1002CFE4C);
    detour(0x1002CFE40,(void*)&ge_entry_a,ge_resume_a,"checkSlotsWarnning");
}
