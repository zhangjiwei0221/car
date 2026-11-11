#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <string>
#include <cstdio>
#include <cstring>
static uintptr_t g_base=0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
typedef void* (*fn0)(void); typedef void* (*fn1)(void*);
typedef void* (*fnSprite)(const std::string*);
typedef void (*fnAdd)(void*,void*,int,int);
typedef void (*fnPos)(void*,float,float);
typedef void (*fnScale)(void*,float);
static void L(const char* s){ FILE*f=fopen("/tmp/pp_cal.log","a"); if(f){fprintf(f,"%s\n",s);fclose(f);} }
static void show(void){
    fn0 dirGet=(fn0)S(0x101f8b900); fn1 sceneGet=(fn1)S(0x1003a8650);
    fnSprite sprMake=(fnSprite)S(0x101de7280); fnAdd addChild=(fnAdd)S(0x101dba310);
    fnPos setPos=(fnPos)S(0x101db8bf0); fnScale setScale=(fnScale)S(0x101db8920);
    void* d=dirGet(); void* sc=d?sceneGet(d):nullptr; if(!sc){L("no scene");return;}
    std::string n("cal.png"); void* sp=sprMake(&n); if(!sp){L("sprite fail");return;}
    setPos(sp,100.0f,100.0f); setScale(sp,1.0f);
    addChild(sc,sp,20000,20000); L("cal sprite added at (100,100) scale 1");
}
__attribute__((constructor)) static void on_load(void){
    uint32_t c=_dyld_image_count();
    for(uint32_t i=0;i<c;i++){const char* nm=_dyld_get_image_name(i);
        if(nm&&strstr(nm,"MacOS/ParkPassenger")){g_base=(uintptr_t)_dyld_get_image_header(i);break;}}
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,6ull*NSEC_PER_SEC), dispatch_get_main_queue(), ^{ show(); });
}
