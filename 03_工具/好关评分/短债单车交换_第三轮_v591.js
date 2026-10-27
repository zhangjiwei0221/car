#!/usr/bin/env node
/** v591：在v590最佳基底上做第三轮单对交换。 */
'use strict';
process.env.ROUND = 'v591';
process.env.MAX_PAIRS = process.env.MAX_PAIRS || '12';
require('./短债单车交换_v589.js');
