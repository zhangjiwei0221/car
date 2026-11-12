#!/usr/bin/env node
'use strict';
/**
 * 把两阶段统计合并进 sequences.json，并重新生成 序列清单.md。
 * 阶段 1：5000 局随机对局（首轮，统计见日志）
 * 阶段 2：多根定向 beam（当前 sequences.json 中的 30 条序列即来自此轮）
 * 不改动任何序列内容，只补统计与说明。
 */
const fs = require('fs');
const path = require('path');
const { renderMarkdown } = require('./search_sequences.js');

const JSON_FILE = path.join(__dirname, 'sequences.json');
const MD_FILE = path.join(__dirname, '序列清单.md');

const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
data.generatedAt = new Date().toISOString();

data.stats.randomPhase = {
  games: 5000,
  seeds: '1000..5999（LCG）',
  gamesWithGroup2: 107,
  group2PickableStates: 320,
  group2PickableAndBuf3: 166,
  uniqueHits: 93,
  note: '随机轮用于摸底与估命中率；最终清单的序列来自随后一轮多根定向 beam。'
};
data.stats.beamPhase = {
  roots: 6,
  width: 160,
  depth: 18,
  expandCap: 8,
  hitsRaw: data.stats.hitsRaw,
  uniqueHits: data.stats.uniqueSequences,
  enter5Attempts: data.stats.enter5Attempts,
  after5Rejected: data.stats.after5Rejected,
  bufAfterDistribution: data.stats.bufAfterDistribution,
  runtimeSeconds: 205
};
data.stats.totalGames = 5000;
data.stats.gamesWithGroup2 = 107;
data.stats.group2PickableStates = 320;
data.stats.group2PickableAndBuf3 = 166;
data.stats.budget = {
  maxGames: 6000,
  maxMinutes: 40,
  officialRandomGames: 5000,
  exhausted: null
};

fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2));
fs.writeFileSync(MD_FILE, renderMarkdown(data));
console.log('updated', JSON_FILE);
console.log('updated', MD_FILE);
