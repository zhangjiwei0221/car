#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <mach/mach_vm.h>
#include <libkern/OSCacheControl.h>
#include <string>
#include <cstdio>
#include <cstring>
#include <cstdarg>
#include <vector>
#include <sys/stat.h>
#include <time.h>
static long g_sec=0, g_nsec=0;

static uintptr_t g_base=0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
typedef void* (*fn0)(void); typedef void* (*fn1)(void*);
typedef void* (*fnSprite)(const std::string*);
typedef void (*fnAdd)(void*,void*,int,int);
typedef void (*fnPos)(void*,float,float);
typedef void (*fnScale)(void*,float);
typedef void (*fnRot)(void*,float);
typedef void (*fnVis)(void*,bool);

static void L(const char* fmt,...){ FILE*f=fopen("/tmp/pp_border.log","a"); if(!f)return; va_list a; va_start(a,fmt); vfprintf(f,fmt,a); va_end(a); fputc('\n',f); fclose(f); }

struct BX { float x0,y0,x1,y1,thick; char tex[64]; };
static BX g_r = {0,0,0,0,0,"warn.png"};
static char g_tex[64]="";
static std::vector<void*> g_tiles;
static void* g_scene=nullptr;
static long g_mtime=0;
static int g_show=0, g_drawn=0;
static uint64_t g_ready_at=0;
static uint64_t ms_now(){ return clock_gettime_nsec_np(CLOCK_UPTIME_RAW)/1000000ULL; }

static void hide_all(void){
    fnVis setVis=(fnVis)S(0x101db8ee0);
    for(void* t : g_tiles) setVis(t,false);
}

static void layout(void){
    if(ms_now() < g_ready_at) return;                  /* 引擎未就绪 */
    if(!g_show || !g_scene || g_r.thick<=0) { hide_all(); return; }
    fnSprite sprMake=(fnSprite)S(0x101de7280);
    fnAdd addChild=(fnAdd)S(0x101dba310);
    fnPos setPos=(fnPos)S(0x101db8bf0);
    fnScale setScale=(fnScale)S(0x101db8920);
    fnRot setRot=(fnRot)S(0x101db8200);
    fnVis setVis=(fnVis)S(0x101db8ee0);

    const float TW=132.0f, TH=84.0f;
    float s = g_r.thick / TH;
    float tileW = TW * s;
    if(tileW <= 1) return;

    struct T { float x,y,rot; };
    std::vector<T> want;
    /* 上边：贴在 rect 上方（外侧） */
    for(float x=g_r.x0; x<g_r.x1; x+=tileW) want.push_back({x+tileW*0.5f, g_r.y1+g_r.thick*0.5f, 0});
    /* 左边 / 右边：贴在 rect 外侧，旋转 90° */
    for(float y=g_r.y0; y<g_r.y1; y+=tileW) want.push_back({g_r.x0-g_r.thick*0.5f, y+tileW*0.5f, 90});
    for(float y=g_r.y0; y<g_r.y1; y+=tileW) want.push_back({g_r.x1+g_r.thick*0.5f, y+tileW*0.5f, 90});

    if(strcmp(g_tex, g_r.tex)!=0){
        /* 换贴图：旧的全部隐藏（不复用），重建 */
        for(void* t : g_tiles) setVis(t,false);
        g_tiles.clear();
        strncpy(g_tex, g_r.tex, sizeof(g_tex)-1);
        L("[ge] texture -> %s", g_tex);
    }
    static int made=0;
    while((int)g_tiles.size() < (int)want.size() && made < 400){
        std::string n(g_r.tex); void* sp=sprMake(&n);
        if(!sp) break;
        addChild(g_scene, sp, 15000, 15000);
        g_tiles.push_back(sp); made++;
    }
    for(size_t i=0;i<g_tiles.size();i++){
        if(i<want.size()){
            setVis(g_tiles[i],true); setScale(g_tiles[i],s);
            setRot(g_tiles[i],want[i].rot); setPos(g_tiles[i],want[i].x,want[i].y);
        } else setVis(g_tiles[i],false);
    }
    L("[ge] layout tiles=%zu thick=%.0f rect=(%.0f,%.0f)-(%.0f,%.0f)", want.size(), g_r.thick, g_r.x0,g_r.y0,g_r.x1,g_r.y1);
}

static bool readRect(BX& r){
    FILE* f=fopen("/tmp/pp_border.json","r"); if(!f) return false;
    char b[256]; size_t n=fread(b,1,sizeof(b)-1,f); b[n]=0; fclose(f);
    float a,c,d,e,g; char t[64]="warn.png";
    int cnt=sscanf(b,"%f %f %f %f %f %63s",&a,&c,&d,&e,&g,t);
    if(cnt<5) return false;
    r.x0=a; r.y0=c; r.x1=d; r.y1=e; r.thick=g;
    strncpy(r.tex, cnt>=6?t:"warn.png", sizeof(r.tex)-1); r.tex[sizeof(r.tex)-1]=0;
    return true;
}

extern "C" void ge_on_level_start(void){ g_show=1; L("[ge] level START"); layout(); g_drawn=1; }
extern "C" void ge_on_level_end(void){ g_show=0; g_drawn=0; L("[ge] level END -> hide"); hide_all(); }

extern "C" uint64_t ge_resume_start=0, ge_resume_quit=0, ge_resume_check=0;
extern "C" void ge_ent_start(void); extern "C" void ge_ent_quit(void); extern "C" void ge_ent_check(void);
extern "C" void ge_on_check_seen(void){ if(!g_show){ g_show=1; L("[ge] in-level (slot check)"); layout(); g_drawn=1; } }

__asm__(
".text\n"
".globl _ge_ent_start\n"
"_ge_ent_start:\n"
"  pushq %rsi\n  pushq %rdi\n  subq $8, %rsp\n  callq _ge_on_level_start\n  addq $8, %rsp\n  popq %rdi\n  popq %rsi\n"
"  pushq %rbp\n  movq %rsp, %rbp\n  subq $0x260, %rsp\n  movb %sil, %al\n  movq %rdi, -0x8(%rbp)\n"
"  movq _ge_resume_start(%rip), %rax\n  jmpq *%rax\n"
".globl _ge_ent_check\n"
"_ge_ent_check:\n"
"  pushq %rbx\n  movq %rdi, %rbx\n  callq _ge_on_check_seen\n  movq %rbx, %rdi\n  popq %rbx\n"
"  pushq %rbp\n  movq %rsp, %rbp\n  subq $0x20, %rsp\n  movq %rdi, -0x8(%rbp)\n"
"  movq _ge_resume_check(%rip), %rax\n  jmpq *%rax\n"
".globl _ge_ent_quit\n"
"_ge_ent_quit:\n"
"  pushq %rdi\n  callq _ge_on_level_end\n  popq %rdi\n"
"  pushq %rbp\n  movq %rsp, %rbp\n  subq $0x10, %rsp\n  movq %rdi, -0x8(%rbp)\n"
"  movq _ge_resume_quit(%rip), %rax\n  jmpq *%rax\n"
);

static void detour(uint64_t va, void* hook, int nbytes, const char* tag){
    uintptr_t entry=(uintptr_t)S(va); uintptr_t page=entry & ~0xFFFULL;
    kern_return_t kr=mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_WRITE|VM_PROT_COPY);
    if(kr!=KERN_SUCCESS){ L("[ge] %s vm_protect %d",tag,kr); return; }
    unsigned char patch[32]; memset(patch,0x90,sizeof(patch));
    patch[0]=0x48; patch[1]=0xB8; uint64_t tgt=(uint64_t)hook; memcpy(patch+2,&tgt,8);
    patch[10]=0xFF; patch[11]=0xE0;
    memcpy((void*)entry,patch,nbytes); sys_icache_invalidate((void*)entry,nbytes);
    mach_vm_protect(mach_task_self(), page, 0x2000, FALSE, VM_PROT_READ|VM_PROT_EXECUTE);
    L("[ge] %s detour %p -> %p (%d bytes)", tag, (void*)entry, hook, nbytes);
}

static void do_tick(void){
    fn0 dirGet=(fn0)S(0x101f8b900); fn1 sceneGet=(fn1)S(0x1003a8650);
    void* d=dirGet(); if(d){ void* sc=sceneGet(d); if(sc) g_scene=sc; }
    if(g_show && !g_drawn && ms_now()>=g_ready_at && g_scene){ L("[ge] draw (deferred)"); layout(); g_drawn=1; }
    struct stat st;
    if(stat("/tmp/pp_border.json",&st)==0){
        if(st.st_mtimespec.tv_sec!=g_sec || st.st_mtimespec.tv_nsec!=g_nsec){
            g_sec=st.st_mtimespec.tv_sec; g_nsec=st.st_mtimespec.tv_nsec;
            BX r; if(readRect(r)){ g_r=r; L("[ge] config reload"); g_drawn=0; layout(); g_drawn=1; }
        }
    }
}
static void schedule_tick(void){
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 700ull*NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        do_tick();
        schedule_tick();
    });
}

__attribute__((constructor)) static void on_load(void){
    uint32_t c=_dyld_image_count();
    for(uint32_t i=0;i<c;i++){ const char* nm=_dyld_get_image_name(i);
        if(nm&&strstr(nm,"MacOS/ParkPassenger")){ g_base=(uintptr_t)_dyld_get_image_header(i); break; } }
    L("[ge] loaded base=%p",(void*)g_base);
    if(!g_base) return;
    g_ready_at = ms_now() + 8000;
    ge_resume_start=(uint64_t)S(0x10022AAE2);
    ge_resume_quit =(uint64_t)S(0x10022B7CC);
    detour(0x10022AAD0,(void*)&ge_ent_start,18,"startLevel");
    ge_resume_check=(uint64_t)S(0x1002CFE4C);
    detour(0x1002CFE40,(void*)&ge_ent_check,12,"checkSlotsWarnning");
    detour(0x10022B7C0,(void*)&ge_ent_quit ,12,"gameQuit");

    schedule_tick();
}
