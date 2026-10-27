#!/usr/bin/env node
/** v590：在v589 Pareto基底上做第二轮单对交换。 */
'use strict';
process.env.ROUND = 'v590';
process.env.MAX_PAIRS = process.env.MAX_PAIRS || '12';
require('./短债单车交换_v589.js');
