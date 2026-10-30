# 006 · StoryPlan v4

## 结论

通过：相邻三连锁与管道均保留三段压力，并完成组债/queue释放。

## 障碍

- 黑块：`(1,1)`、`(1,2)`；
- 相邻三连锁：`(5,1) 34/25`、`(5,2) 30/23`、`(5,3) 28/23`；
- 管道：`(6,6)`朝上，queue `[13/28]`；
- 数字冰0、问号0；

## 压力窗口

- pressure-1：8～9步，峰值3，可见动作5，目标区R223、R138、R222、R224、R183、R199。
- pressure-2：21～28步，峰值4，可见动作8，目标区R131、R219、R158、R160、R172、R32。
- pressure-3：32～44步，峰值4，可见动作11，目标区R127、R12、R59、R65、R18、R73。

## 消融

- 移除三连锁：[{"peak":4,"windows":[{"start":8,"end":9,"peak":3},{"start":21,"end":28,"peak":4}]},{"peak":4,"windows":[{"start":8,"end":9,"peak":3},{"start":21,"end":28,"peak":4}]},{"peak":4,"windows":[{"start":8,"end":9,"peak":3},{"start":21,"end":28,"peak":4}]}]；
- 移除管道：[{"peak":4,"windows":[{"start":8,"end":9,"peak":3},{"start":21,"end":28,"peak":4},{"start":32,"end":43,"peak":4}]},{"peak":4,"windows":[{"start":8,"end":9,"peak":3},{"start":21,"end":28,"peak":4},{"start":32,"end":43,"peak":4}]},{"peak":4,"windows":[{"start":8,"end":9,"peak":3},{"start":21,"end":28,"peak":4},{"start":32,"end":43,"peak":4}]}]；
- 移除黑块：[{"won":true,"progress":100,"peak":4,"windows":[{"start":22,"end":27,"peak":4},{"start":36,"end":44,"peak":4}]},{"won":true,"progress":100,"peak":4,"windows":[{"start":22,"end":27,"peak":4},{"start":36,"end":44,"peak":4}]},{"won":true,"progress":100,"peak":4,"windows":[{"start":22,"end":27,"peak":4},{"start":36,"end":44,"peak":4}]}]。

