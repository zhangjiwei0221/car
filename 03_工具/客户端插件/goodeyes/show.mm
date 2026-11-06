#import <Foundation/Foundation.h>
#import <mach-o/dyld.h>
#include <string>
#include <thread>
#include <chrono>
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
typedef void  (*fnSetAnchor)(void*, const void*);

static void go(const char* file, float scale){
    auto dirGet   = (fn0)S(0x101f8b900);          // Director::getInstance
    auto sceneGet = (fn1)S(0x1003a8650);          // Director::getRunningScene
    auto visGet   = (VSize(*)(void*))S(0x101f8fe40);// Director::getVisibleSize
    auto sprMake  = (fnSprite)S(0x101de7280);     // Sprite::create(std::string const&)
    auto addChild = (fnAdd)S(0x101dba310);        // Node::addChild(Node*,int,int)
    auto setPos   = (fnSetPos)S(0x101db8bf0);     // Node::setPosition(float,float)
    auto setScale = (fnSetScale)S(0x101db8920);   // Node::setScale(float)

    void* dir = dirGet();
    if(!dir){ printf("[ge] no director\n"); return; }
    void* scene = sceneGet(dir);
    if(!scene){ printf("[ge] no scene\n"); return; }
    std::string name(file);
    void* sp = sprMake(&name);
    if(!sp){ printf("[ge] sprite create failed: %s\n", file); return; }
    VSize v = visGet(dir);
    setPos(sp, v.w*0.5f, v.h*0.5f);
    setScale(sp, scale);
    addChild(scene, sp, 10000, 10000);
    printf("[ge] sprite shown %s at %.0f,%.0f size %.0fx%.0f\n", file, v.w*0.5f, v.h*0.5f, v.w, v.h);
    fflush(stdout);
}

__attribute__((constructor))
static void on_load(void){
    g_base = (uintptr_t)_dyld_get_image_vmaddr_slide(0) + 0x100000000ULL;
    FILE* f=fopen("/tmp/pp_show.log","a");
    if(f){ fprintf(f,"loaded base=%p\n",(void*)g_base); fclose(f); }
    std::thread([]{ 
        for(int i=0;i<120;i++){
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            auto dirGet=(fn0)S(0x101f8b900);
            auto sceneGet=(fn1)S(0x1003a8650);
            void* d=dirGet(); if(!d) continue;
            if(sceneGet(d)){ 
                std::this_thread::sleep_for(std::chrono::seconds(6));
                go("0.png", 1.0f);
                return;
            }
        }
    }).detach();
}
