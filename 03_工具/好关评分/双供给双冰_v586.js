#!/usr/bin/env node
/** v586：同时冻结v584路线第29步的两辆完全供给。 */
'use strict';
process.env.ICE_VALUE = '48';
process.env.EXTRA_ICE_CELLS = '4,2;6,1';
process.env.EXTRA_ICE_VALUE = '30';
require('./单冰窗口_v583.js');
