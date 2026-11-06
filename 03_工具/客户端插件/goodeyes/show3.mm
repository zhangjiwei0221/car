#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <string>
#include <cstdio>
#include <cstring>

static uintptr_t g_base=0;
static inline void* S(uint64_t va){ return (void*)(g_base + (va - 0x100000000ULL)); }
struct VSize{ float w,h; };
typedef void* (*fn0)(void); typedef void* (*fn1)(void*);
typedef void* (*fnSprite)(const std::string*);
typedef void (*fnAdd)(void*,void*,int,int); typedef void (*fnPos)(void*,float,float); typedef void (*fnScale)(void*,float);

static void L(const char* fmt,...){ FILE*f=fopen("/tmp/pp_show.log","a"); if(!f)return; va_list a; va_start(a,fmt); vfprintf(f,fmt,a); va_end(a); fputc('\n',f); fclose(f); }

static void show(void){
    fn0 dirGet=(fn0)S(0x101f8b900);
    fn1 sceneGet=(fn1)S(0x1003a8650);
    auto visGet=(VSize(*)(void*))S(0x101f8fe40);
    auto sprMake=(fnSprite)S(0x101de7280);
    fnAdd addChild=(fnAdd)S(0x101dba310);
    fnPos setPos=(fnPos)S(0x101db8bf0);
    fnScale setScale=(fnScale)S(0x101db8920);
    void* d=dirGet(); L("[ge] director=%p", d);
    if(!d) return;
    void* sc=sceneGet(d); L("[ge] scene=%p", sc); if(!sc) return;
    VSize v; v.w=540; v.h=960;   // 竖屏设计分辨率 1080x1920 的中心（先估）
    L("[ge] before sprite");
    const char* c="good_eyes.png"; std::string n(c);
    L("[ge] string built size=%zu", n.size());
    void* sp=sprMake(&n); L("[ge] sprite(%s)=%p", c, sp);
    if(!sp) return;
    setPos(sp, v.w*0.5f, v.h*0.5f); setScale(sp, 0.35f);
    addChild(sc, sp, 10000, 10000); L("[ge] added");
}

__attribute__((constructor))
static void on_load(void){
    uint32_t cnt=_dyld_image_count();
    for(uint32_t i=0;i<cnt;i++){
        const char* nm=_dyld_get_image_name(i);
        L("[ge] img[%u] %p %s", i, (void*)_dyld_get_image_header(i), nm?nm:"?");
        if(nm && strstr(nm,"MacOS/ParkPassenger")) g_base=(uintptr_t)_dyld_get_image_header(i);
    }
    L("[ge] game base=%p dirGet=%p", (void*)g_base, S(0x101f8b900));
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,4ull*NSEC_PER_SEC), dispatch_get_main_queue(), ^{ show(); });
}
