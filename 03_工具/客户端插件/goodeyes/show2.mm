#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <string>
#include <cstdio>

static uintptr_t g_base = 0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
struct VSize { float w, h; };

typedef void* (*fn0)(void);
typedef void* (*fn1)(void*);
typedef void* (*fnSprite)(const std::string*);
typedef void  (*fnAdd)(void*, void*, int, int);
typedef void  (*fnSetPos)(void*, float, float);
typedef void  (*fnSetScale)(void*, float);

static void logf2(const char* fmt, ...){
    FILE* f=fopen("/tmp/pp_show.log","a"); if(!f) return;
    va_list ap; va_start(ap,fmt); vfprintf(f,fmt,ap); va_end(ap); fputc('\n',f); fclose(f);
}

static void tryShow(int attempt){
    auto dirGet=(fn0)S(0x101f8b900);
    auto sceneGet=(fn1)S(0x1003a8650);
    auto visGet=(VSize(*)(void*))S(0x101f8fe40);
    auto sprMake=(fnSprite)S(0x101de7280);
    auto addChild=(fnAdd)S(0x101dba310);
    auto setPos=(fnSetPos)S(0x101db8bf0);
    auto setScale=(fnSetScale)S(0x101db8920);

    void* d=dirGet();
    void* scene = d ? sceneGet(d) : nullptr;
    if(!scene){
        if(attempt<120) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500ull*NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ tryShow(attempt+1); });
        return;
    }
    logf2("[ge] scene ok at attempt %d", attempt);
    VSize v = visGet(d);
    const char* cands[] = {"0.png", "bin/0.png", "./bin/0.png"};
    for(const char* c : cands){
        std::string name(c);
        void* sp = sprMake(&name);
        if(sp){
            setPos(sp, v.w*0.5f, v.h*0.5f);
            setScale(sp, 2.0f);
            addChild(scene, sp, 10000, 10000);
            logf2("[ge] OK sprite=%s view=%.0fx%.0f", c, v.w, v.h);
            return;
        }
        logf2("[ge] fail: %s", c);
    }
}

__attribute__((constructor))
static void on_load(void){
    g_base=(uintptr_t)_dyld_get_image_vmaddr_slide(0)+0x100000000ULL;
    logf2("[ge] loaded base=%p", (void*)g_base);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3ull*NSEC_PER_SEC), dispatch_get_main_queue(), ^{ tryShow(0); });
}
