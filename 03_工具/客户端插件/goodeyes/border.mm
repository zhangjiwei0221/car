#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <string>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>
#include <vector>

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

struct BX { float x0,y0,x1,y1,thick; };

static std::vector<void*> g_tiles;
static void* g_scene=nullptr;
static time_t g_mtime=0;

static bool readRect(BX& r){
    FILE* f=fopen("/tmp/pp_border.json","r"); if(!f) return false;
    char buf[512]; size_t n=fread(buf,1,sizeof(buf)-1,f); buf[n]=0; fclose(f);
    float a,b,c,d,e;
    if(sscanf(buf,"%f %f %f %f %f",&a,&b,&c,&d,&e)!=5) return false;
    r.x0=a; r.y0=b; r.x1=c; r.y1=d; r.thick=e; return true;
}

static void layout(const BX& r){
    fnSprite sprMake=(fnSprite)S(0x101de7280);
    fnAdd addChild=(fnAdd)S(0x101dba310);
    fnPos setPos=(fnPos)S(0x101db8bf0);
    fnScale setScale=(fnScale)S(0x101db8920);
    fnRot setRot=(fnRot)S(0x101db8200);
    fnVis setVis=(fnVis)S(0x101db8ee0);

    static int made=0;
    const float TW=132.0f, TH=84.0f;
    float s = r.thick / TH;            /* 竖向厚度 = thick */
    float tileW = TW * s;              /* 平铺长度 */
    if(tileW <= 1) return;

    struct T { float x,y,rot; };
    std::vector<T> want;
    for(float x=r.x0; x<r.x1; x+=tileW) want.push_back({x+tileW*0.5f, r.y1-r.thick*0.5f, 0});      /* 上 */
    for(float y=r.y0; y<r.y1; y+=tileW) want.push_back({r.x0+r.thick*0.5f, y+tileW*0.5f, 90});       /* 左 */
    for(float y=r.y0; y<r.y1; y+=tileW) want.push_back({r.x1-r.thick*0.5f, y+tileW*0.5f, 90});       /* 右 */

    while((int)g_tiles.size() < (int)want.size() && made < 400){
        std::string n("warn.png"); void* sp=sprMake(&n);
        if(!sp) break;
        addChild(g_scene, sp, 15000, 15000);
        g_tiles.push_back(sp); made++;
    }
    for(size_t i=0;i<g_tiles.size();i++){
        if(i < want.size()){
            setVis(g_tiles[i], true);
            setScale(g_tiles[i], s);
            setRot(g_tiles[i], want[i].rot);
            setPos(g_tiles[i], want[i].x, want[i].y);
        } else setVis(g_tiles[i], false);
    }
    L("[ge] layout tiles=%zu thick=%.1f tileW=%.1f rect=(%.0f,%.0f)-(%.0f,%.0f)", want.size(), r.thick, tileW, r.x0,r.y0,r.x1,r.y1);
}

__attribute__((constructor)) static void on_load(void){
    uint32_t c=_dyld_image_count();
    for(uint32_t i=0;i<c;i++){ const char* nm=_dyld_get_image_name(i);
        if(nm&&strstr(nm,"MacOS/ParkPassenger")){ g_base=(uintptr_t)_dyld_get_image_header(i); break; } }
    L("[ge] loaded base=%p",(void*)g_base);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,6ull*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        /* 每秒看一次配置 */
        dispatch_source_t t=dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,0,0,dispatch_get_main_queue());
        dispatch_source_set_timer(t,dispatch_time(DISPATCH_TIME_NOW,0),1ull*NSEC_PER_SEC,0);
        dispatch_source_set_event_handler(t,^{
            fn0 dirGet=(fn0)S(0x101f8b900); fn1 sceneGet=(fn1)S(0x1003a8650);
            void* d=dirGet(); if(!d) return;
            void* sc=sceneGet(d); if(!sc) return;
            g_scene=sc;
            struct stat st; if(stat("/tmp/pp_border.json",&st)!=0) return;
            if(st.st_mtime==g_mtime) return;
            g_mtime=st.st_mtime;
            BX r; if(readRect(r)) layout(r);
        });
        dispatch_resume(t);
    });
}
