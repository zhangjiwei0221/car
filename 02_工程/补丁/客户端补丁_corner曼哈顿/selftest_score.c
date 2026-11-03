// selftest_score.c —— 直接执行被补丁改过的 TargetBoard::_getCandidateScore 那 7 个字节
// 用法: clang -arch x86_64 -O0 -o selftest_score selftest_score.c
//       arch -x86_64 ./selftest_score <可执行文件> [文件偏移=0x3f19c0] [长度=234]
// 期望: 对任意 (r,c)，返回 r+c；X/Y 传垃圾值也不影响。
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/mman.h>

typedef int64_t (*score_fn)(const void *self, int r, int c, int X, int Y);

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <binary> [offset] [len]\n", argv[0]); return 2; }
    const char *path = argv[1];
    unsigned long off = (argc > 2) ? strtoul(argv[2], 0, 0) : 0x3f19c0UL;
    unsigned long len = (argc > 3) ? strtoul(argv[3], 0, 0) : 234UL;

    FILE *f = fopen(path, "rb");
    if (!f) { perror("open"); return 2; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, (long)off, SEEK_SET);
    if (off + len > (unsigned long)sz) { fprintf(stderr, "offset out of range\n"); return 2; }
    unsigned char *buf = malloc(len);
    if (fread(buf, 1, len, f) != len) { fprintf(stderr, "read failed\n"); return 2; }
    fclose(f);

    printf("执行字节: ");
    for (unsigned long i = 0; i < 8 && i < len; i++) printf("%02x", buf[i]);
    printf(" ...\n");

    void *p = mmap(NULL, 4096, PROT_READ | PROT_WRITE | PROT_EXEC,
                   MAP_PRIVATE | MAP_ANON, -1, 0);
    if (p == MAP_FAILED) { perror("mmap"); return 2; }
    memcpy(p, buf, len);
    score_fn fn = (score_fn)p;

    static const int vals[] = {0, 1, 2, 3, 4, 7, 9, 15, 39, 40, 63};
    static const int nv = sizeof(vals) / sizeof(vals[0]);
    int bad = 0, total = 0;
    for (int i = 0; i < nv; i++) {
        for (int j = 0; j < nv; j++) {
            int r = vals[i], c = vals[j];
            // X/Y 故意给互相矛盾的垃圾值：文档要求起点不随槽位变化
            int64_t got1 = fn(NULL, r, c, 0, 1);
            int64_t got2 = fn(NULL, r, c, 7, 9);
            int64_t want = (int64_t)r + (int64_t)c;
            total += 2;
            if (got1 != want || got2 != want) {
                printf("FAIL r=%d c=%d  got(X=0,Y=1)=%lld got(X=7,Y=9)=%lld  want=%lld\n",
                       r, c, (long long)got1, (long long)got2, (long long)want);
                bad++;
            }
        }
    }
    printf("score selftest: %d 次调用, %d 次不符\n", total, bad);
    return bad ? 1 : 0;
}
