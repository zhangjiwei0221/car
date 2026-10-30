# 启动器（Foolproof Launcher）

傻瓜式跨平台启动器的源码与测试目录。

## 目录结构

```
启动器/
├── lib/        # 纯函数规范层（launcher-core.js 等，无 I/O，受属性测试覆盖）
├── test/       # 单元 / 属性 / 集成 / 冒烟测试（基于 node:test）
└── README.md
```

## 测试

- 测试框架：Node 内置 `node:test` + [fast-check](https://github.com/dubzzz/fast-check)（属性测试）。
- 运行全部测试（在包根执行）：

  ```bash
  npm test        # 等价于 node --test 启动器/test/
  ```

## 测试约定

- **属性测试迭代次数：** 每条属性测试至少运行 **100** 次迭代（fast-check `numRuns: 100`）。
- **属性测试注释格式：** 每条属性测试以如下注释标注其对应的设计属性编号与文本：

  ```js
  // Feature: foolproof-launcher, Property {n}: {property text}
  ```

  例如：

  ```js
  // Feature: foolproof-launcher, Property 1: Node 版本解析与门槛判定
  ```

- 属性测试仅覆盖 `lib/launcher-core.js` 的纯判定 / 文本生成逻辑（设计文档中的 4 条 Correctness Properties）。
- 解压、spawn 进程、端口等待、打开浏览器、写文件、shell/batch 脚本等副作用部分使用示例 / 集成 / 冒烟测试，不强加属性测试。
