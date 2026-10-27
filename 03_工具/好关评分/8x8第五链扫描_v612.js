#!/usr/bin/env node
/** v612：在v611四链基底的第36～45步扫描第五组小链。 */
'use strict';

process.env.TASK_BASE_LEVEL = '03_工具/好关评分/8x8第四链扫描_v611.levels/3_1__4_1.json';
process.env.TASK_OUTPUT = '8x8第五链扫描_v612.json';
process.env.TASK_LEVEL_DIR = '8x8第五链扫描_v612.levels';
process.env.TASK_WINDOW_START = '36';
process.env.TASK_WINDOW_END = '45';
process.env.TASK_CHAIN_ID = '3102';
process.env.TASK_MID_FLOOR = '40.6';
process.env.TASK_SCHEMA = 'eight-by-eight-fifth-chain-v612';
require('./8x8第四链扫描_v611.js');
