'use strict';

/**
 * launcher-core.js — 纯函数规范层（无 I/O）
 *
 * 供编排脚本（orchestrator.js）调用，并作为引导脚本判定逻辑的规范参考实现。
 * 本文件中的所有函数必须保持纯函数特性：相同输入产生相同输出，无副作用、无 I/O。
 *
 * 设计参考：design.md "Components › 6. 纯函数库 launcher-core.js"
 */

// Node_Version_Floor：运行 server.js 所需的最低 Node.js 主版本。
const NODE_VERSION_FLOOR = 18;

// Node_Download_URL：Node.js 官方 LTS 版本下载页面地址。
const NODE_DOWNLOAD_URL = 'https://nodejs.org/zh-cn/download';

/**
 * 解析 `node -v` 风格的版本输出，提取主版本号。
 *
 * 容忍前后空白与换行，以及可选的前导 `v`。例如 `"v22.11.0\n"` -> 22。
 * 对于空串、非版本字符串（如 `"node: command not found"`）等非法输入，返回 null。
 *
 * @param {string} versionOutput 形如 "v22.11.0\n" 的版本输出
 * @returns {number|null} 主版本号；无法解析时为 null
 */
function parseNodeMajor(versionOutput) {
  if (typeof versionOutput !== 'string') {
    return null;
  }
  // 去除前后空白/换行，容忍可选前导 'v'，匹配形如 M.m.p 的版本串。
  const match = versionOutput.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

/**
 * 判定给定主版本号是否满足最低支持版本（Node_Version_Floor = 18）。
 *
 * 当且仅当 major 为数值且 major >= 18 时返回 true。
 * 非数值/null/NaN 等输入一律返回 false。
 *
 * @param {number} major 主版本号
 * @returns {boolean} 是否受支持
 */
function isNodeSupported(major) {
  if (typeof major !== 'number' || !Number.isFinite(major)) {
    return false;
  }
  return major >= NODE_VERSION_FLOOR;
}

/**
 * 将平台标识（如 process.platform 的取值）分类为启动器内部的三态。
 *
 * 'darwin' -> 'macos'；'win32' -> 'windows'；其它一律 -> 'unsupported'。
 *
 * @param {string} platform 平台标识字符串
 * @returns {'macos'|'windows'|'unsupported'} 分类结果
 */
function classifyOS(platform) {
  if (platform === 'darwin') {
    return 'macos';
  }
  if (platform === 'win32') {
    return 'windows';
  }
  return 'unsupported';
}

/**
 * 返回指定操作系统所用的路径分隔符。
 *
 * 'macos' -> '/'；'windows' -> '\\'。
 *
 * @param {'macos'|'windows'} os 操作系统分类
 * @returns {'/'|'\\'} 路径分隔符
 */
function pathSep(os) {
  return os === 'windows' ? '\\' : '/';
}

/**
 * 解析便携 Node 归档顶层目录名，提取其目标平台与架构。
 *
 * 形如 `node-v{ver}-{platform}-{arch}`，例如
 * `"node-v22.11.0-darwin-arm64"` -> `{ platform: 'darwin', arch: 'arm64' }`。
 * 无法匹配的目录名返回 null。
 *
 * @param {string} dirName 归档顶层目录名
 * @returns {{platform: string, arch: string}|null} 解析结果；非法时为 null
 */
function parseArchiveTarget(dirName) {
  if (typeof dirName !== 'string') {
    return null;
  }
  // node-v<major>.<minor>.<patch>-<platform>-<arch>
  const match = dirName
    .trim()
    .match(/^node-v\d+\.\d+\.\d+-([a-z0-9]+)-([a-z0-9_]+)$/i);
  if (!match) {
    return null;
  }
  return { platform: match[1], arch: match[2] };
}

/**
 * 判定便携 Node 归档是否与当前平台匹配。
 *
 * 当且仅当 target.platform === current.platform 且 target.arch === current.arch
 * 时返回 true。任一为 null/缺字段一律返回 false。
 *
 * @param {{platform: string, arch: string}|null} target 归档解析结果
 * @param {{platform: string, arch: string}|null} current 当前平台
 * @returns {boolean} 是否匹配
 */
function archiveMatches(target, current) {
  if (!target || !current) {
    return false;
  }
  return target.platform === current.platform && target.arch === current.arch;
}

/**
 * 生成针对指定操作系统的完整中文 Node.js 安装指引文本。
 *
 * 文本同时包含：Node 下载地址、最低主版本号（18）、与该 OS 匹配的安装包类型
 * （macOS 为 .pkg、Windows 为 .msi），以及"安装完成后重新双击对应入口"的重启动说明。
 *
 * @param {'macos'|'windows'} os 操作系统分类
 * @returns {string} 完整中文安装指引文本
 */
function buildInstallGuide(os) {
  const isWindows = os === 'windows';
  const installerType = isWindows ? '.msi' : '.pkg';
  const osName = isWindows ? 'Windows' : 'macOS';
  const entryName = isWindows ? '启动_Windows.bat' : '启动_Mac.command';

  return [
    `===== 如何安装 Node.js（${osName}）=====`,
    '',
    '本工具需要 Node.js 运行时才能启动。当前电脑未检测到可用的 Node.js，',
    `且包内便携 Node 不支持当前平台，请按以下步骤手动安装（需要 Node.js ${NODE_VERSION_FLOOR} 或更高主版本）：`,
    '',
    `第 1 步：打开浏览器，访问 Node.js 官方下载页面：${NODE_DOWNLOAD_URL}`,
    `第 2 步：下载 ${osName} 安装包（${installerType} 格式）。请选择 LTS 版本，其主版本不低于 ${NODE_VERSION_FLOOR}。`,
    `第 3 步：双击下载好的 ${installerType} 安装包，按照提示完成安装。`,
    `第 4 步：安装完成后重新双击对应入口（${entryName}），启动器会自动检测到新安装的 Node.js 并继续启动流程。`,
    '',
    `提示：安装完成后无需做任何额外配置，重新双击 ${entryName} 即可。`,
  ].join('\n');
}

module.exports = {
  NODE_VERSION_FLOOR,
  NODE_DOWNLOAD_URL,
  parseNodeMajor,
  isNodeSupported,
  classifyOS,
  pathSep,
  parseArchiveTarget,
  archiveMatches,
  buildInstallGuide,
};
