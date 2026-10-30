/**
 * 毛线JSON关卡编辑器 - 验证模块
 * 包含颜色对应检查、可达性验证、路线分析
 */

var YarnLevel = YarnLevel || {};

YarnLevel.Validator = (function() {

  // ==================== BFS工具 ====================

  /**
   * 判断一个格子是否是障碍（不可通过）
   * 黑块(id=-1)和管道都算障碍
   */
  function isObstacle(spool) {
    if (!spool) return true;
    if (spool.id === -1) return true;
    if (YarnLevel.isPipeType(spool.type)) return true;
    return false;
  }

  /**
   * BFS从第一行出发，计算到每个格子的最短距离
   * @param {Array} spools - 2D棋盘数据
   * @param {number} maprow
   * @param {number} mapcol
   * @returns {Array} 2D距离数组，-1表示不可达
   */
  function bfsFromTopRow(spools, maprow, mapcol) {
    var dist = [];
    for (var r = 0; r < maprow; r++) {
      dist[r] = [];
      for (var c = 0; c < mapcol; c++) {
        dist[r][c] = -1;
      }
    }

    var queue = [];

    // 从第一行所有非障碍格出发
    for (var c = 0; c < mapcol; c++) {
      var spool = spools[0] && spools[0][c];
      if (spool && !isObstacle(spool)) {
        dist[0][c] = 0;
        queue.push({ row: 0, col: c });
      }
    }

    // 四方向BFS
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (queue.length > 0) {
      var curr = queue.shift();
      var currDist = dist[curr.row][curr.col];

      for (var d = 0; d < dirs.length; d++) {
        var nr = curr.row + dirs[d][0];
        var nc = curr.col + dirs[d][1];

        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        if (dist[nr][nc] !== -1) continue;

        var nextSpool = spools[nr] && spools[nr][nc];
        if (!nextSpool || isObstacle(nextSpool)) continue;

        dist[nr][nc] = currDist + 1;
        queue.push({ row: nr, col: nc });
      }
    }

    return dist;
  }

  /**
   * 计算从第一行到指定格子的最短距离
   */
  function getDistanceToCell(spools, maprow, mapcol, targetRow, targetCol) {
    var dist = bfsFromTopRow(spools, maprow, mapcol);
    return dist[targetRow] ? dist[targetRow][targetCol] : -1;
  }

  // ==================== 颜色对应检查 ====================

  /**
   * 检查颜色对应关系
   * 规则：目标区(blocks)每种颜色数量 = 棋盘区(spools)同色数量 × 3
   * 即棋盘区每消除1个颜色球，点亮目标区3个同色格子
   */
  function checkColorCounts(spools, blocks) {
    var blockColors = {}; // 目标区颜色统计
    var spoolColors = {}; // 棋盘区颜色统计（格子+管道内）

    // 统计目标区(blocks)颜色
    if (blocks && blocks.length > 0) {
      for (var r = 0; r < blocks.length; r++) {
        if (!blocks[r]) continue;
        for (var c = 0; c < blocks[r].length; c++) {
          var blockId = YarnLevel.getBlockId(blocks[r][c]);
          if (blockId > 0) {
            blockColors[blockId] = (blockColors[blockId] || 0) + 1;
          }
        }
      }
    }

    // 统计棋盘区(spools)颜色（格子 + 管道param）
    if (spools) {
      for (var r = 0; r < spools.length; r++) {
        if (!spools[r]) continue;
        for (var c = 0; c < spools[r].length; c++) {
          var spool = spools[r][c];
          if (!spool) continue;
          if (spool.id > 0) {
            spoolColors[spool.id] = (spoolColors[spool.id] || 0) + 1;
          }
          if (Array.isArray(spool.param)) {
            for (var p = 0; p < spool.param.length; p++) {
              var pid = spool.param[p];
              if (pid > 0) {
                spoolColors[pid] = (spoolColors[pid] || 0) + 1;
              }
            }
          }
        }
      }
    }

    // 合并所有颜色ID
    var allIds = {};
    for (var id in blockColors) allIds[id] = true;
    for (var id in spoolColors) allIds[id] = true;
    var ids = Object.keys(allIds).map(Number).sort(function(a, b) { return a - b; });

    // 以目标区为基准对比
    // 规则：棋盘区应有 = 目标区数量 / 3
    var colorDetails = [];
    var valid = true;
    for (var i = 0; i < ids.length; i++) {
      var cid = ids[i];
      var bCount = blockColors[cid] || 0; // 目标区像素数
      var sCount = spoolColors[cid] || 0; // 棋盘区球数
      var expectedSpool = Math.floor(bCount / 3); // 棋盘应有数量
      var isMatch = (sCount === expectedSpool);
      if (!isMatch) valid = false;
      colorDetails.push({
        colorId: cid,
        colorName: YarnLevel.getColorName(cid),
        cssColor: YarnLevel.getColorCSS(cid),
        blockCount: bCount,
        spoolCount: sCount,
        expectedSpool: expectedSpool,
        diff: sCount - expectedSpool, // 正=多余, 负=缺少
        match: isMatch
      });
    }

    return { valid: valid, colorDetails: colorDetails };
  }

  // ==================== 可达性验证 ====================

  /**
   * 检查所有非障碍格是否可达
   * @returns {Object} { allReachable, unreachableCells: [{row, col}] }
   */
  function checkReachability(spools, maprow, mapcol) {
    var dist = bfsFromTopRow(spools, maprow, mapcol);
    var unreachableCells = [];

    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool) continue;
        if (isObstacle(spool)) continue;
        if (dist[r][c] === -1) {
          unreachableCells.push({ row: r, col: c });
        }
      }
    }

    return {
      allReachable: unreachableCells.length === 0,
      unreachableCells: unreachableCells,
      distanceMap: dist
    };
  }

  /**
   * 死锁检测（重写版）：检测所有可能导致关卡无法通关的结构性死锁
   * 
   * 检测项：
   * 1. 基础可达性：从第一行BFS不可达的格子
   * 2. 锁链死锁：锁链两端中某一端无法从第一行独立到达（不经过另一端）
   * 3. 窄路锁链死锁（核心新增）：
   *    - 窄路口有锁链球，锁链另一端在窄路更深处或窄路外的不可达区域
   *    - 必须两端同时激活才能拾取，但由于窄路阻挡另一端无法被激活
   *    - 典型场景：管道+黑块+墙壁形成宽度1通道，入口球被锁链拴住
   * 4. 被完全包围的格子（四面障碍）
   * 5. 孤立区域：连通分量内所有锁链都互相依赖形成循环死锁
   */
  function checkDeadlocks(spools, maprow, mapcol) {
    var deadlocks = [];
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    
    function isObs(s) { return !s || s.id === -1 || YarnLevel.isPipeType(s.type); }
    function isFrozen(s) {
      if (!s) return false;
      var types = Array.isArray(s.type) ? s.type : [s.type];
      return types.indexOf(4) !== -1;
    }
    function isChain(s) {
      if (!s) return false;
      var types = Array.isArray(s.type) ? s.type : [s.type];
      return types.indexOf(5) !== -1;
    }

    // === 第一步：BFS可达性检查 ===
    var dist = bfsFromTopRow(spools, maprow, mapcol);
    var unreachableSet = {};
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool || isObs(spool)) continue;
        if (spool.id <= 0) continue;
        if (dist[r][c] === -1) {
          deadlocks.push({ type: 'unreachable', row: r, col: c, reason: '从第一行不可达（被黑块/管道/边界完全隔离）' });
          unreachableSet[r + ',' + c] = true;
        }
      }
    }

    // === 第二步：找所有锁链对 ===
    var paired = {};
    var chainPairs = []; // [{r1, c1, r2, c2}]
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool || spool.id <= 0) continue;
        var key = r + ',' + c;
        if (paired[key]) continue;
        if (!isChain(spool)) continue;

        for (var d = 0; d < dirs.length; d++) {
          var nr = r + dirs[d][0], nc = c + dirs[d][1];
          if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
          var nkey = nr + ',' + nc;
          if (paired[nkey]) continue;
          var ns = spools[nr] && spools[nr][nc];
          if (!ns || ns.id <= 0) continue;
          if (isChain(ns)) {
            chainPairs.push({ r1: r, c1: c, r2: nr, c2: nc });
            paired[key] = true;
            paired[nkey] = true;
            break;
          }
        }
      }
    }

    // === 第三步：锁链死锁检测（增强版）===
    // 规则：锁链两端必须"各自有独立活路"才能被拾取
    // "独立活路" = 从第一行出发，不经过对方，能到达该格
    // 
    // 增强：考虑"激活传播"规则
    // 游戏中激活是从第一行开始逐步传播的，拾取一个格子后它的四邻居被激活
    // 如果锁链A端处于窄路内部，B端在窄路更深处：
    //   - A端可达（第一行能到）但B端必须经过A端才能到达
    //   - 但锁链规则要求B端"先被激活"A才能被拾取
    //   - 如果B端只有经过A才能激活 → 死锁
    
    for (var i = 0; i < chainPairs.length; i++) {
      var pair = chainPairs[i];
      var key1 = pair.r1 + ',' + pair.c1;
      var key2 = pair.r2 + ',' + pair.c2;
      
      // 跳过已经不可达的（第一步已报告）
      if (unreachableSet[key1] || unreachableSet[key2]) continue;
      
      // 检查A端能否不经过B端被到达
      var aReachable = canReachWithout(spools, maprow, mapcol, pair.r1, pair.c1, pair.r2, pair.c2);
      // 检查B端能否不经过A端被到达
      var bReachable = canReachWithout(spools, maprow, mapcol, pair.r2, pair.c2, pair.r1, pair.c1);
      
      if (!aReachable && !bReachable) {
        // 两端互相依赖，完全死锁
        deadlocks.push({
          type: 'chain_deadlock', row: pair.r1, col: pair.c1,
          r2: pair.r2, c2: pair.c2,
          reason: '两端互相依赖，都无法独立到达（必须经过对方）'
        });
      } else if (!aReachable) {
        deadlocks.push({
          type: 'chain_deadlock', row: pair.r1, col: pair.c1,
          r2: pair.r2, c2: pair.c2,
          reason: 'A端(' + pair.r1 + ',' + pair.c1 + ')无独立活路，必须经过B端'
        });
      } else if (!bReachable) {
        deadlocks.push({
          type: 'chain_deadlock', row: pair.r2, col: pair.c2,
          r2: pair.r1, c2: pair.c1,
          reason: 'B端(' + pair.r2 + ',' + pair.c2 + ')无独立活路，必须经过A端'
        });
      }
      
      // === 窄路锁链死锁：更细致的检测 ===
      // 核心问题：BFS可达≠激活可达
      // 游戏规则：激活是从第一行逐步传播的，必须拾取相邻格后才能激活下一格
      // 锁链规则：两端都必须已激活才能拾取
      // 死锁条件：到达锁链两端的**所有**路径都必须经过对方（或对方的前置格子）
      //
      // 新检测：模拟激活传播，检查是否存在一个拾取序列使得两端同时被激活
      // 简化：检查是否有一条路径能"绕过"锁链对到达另一端的邻居
      if (aReachable && bReachable) {
        // 方法：检查是否存在两条独立路径分别到达A和B的"激活邻居"
        // 锁链要被拾取，需要A和B各自有至少一个非对方的已激活邻居
        // 即：A需要一个非B的邻居先被激活（即那个邻居可以从第一行不经过B和A到达）
        //     B需要一个非A的邻居先被激活（即那个邻居可以从第一行不经过A和B到达）
        
        // A的非B邻居中，是否有能不经过A和B到达的
        var aHasIndependentActivator = false;
        for (var d = 0; d < dirs.length; d++) {
          var anr = pair.r1 + dirs[d][0], anc = pair.c1 + dirs[d][1];
          if (anr < 0 || anr >= maprow || anc < 0 || anc >= mapcol) continue;
          if (anr === pair.r2 && anc === pair.c2) continue; // 排除B本身
          var ans = spools[anr] && spools[anr][anc];
          if (!ans || isObs(ans)) continue;
          // 这个邻居能否不经过A和B被从第一行到达？
          var canReachNeighbor = canReachWithoutTwo(spools, maprow, mapcol, anr, anc, pair.r1, pair.c1, pair.r2, pair.c2);
          if (canReachNeighbor) {
            aHasIndependentActivator = true;
            break;
          }
        }
        
        // B的非A邻居中，是否有能不经过A和B到达的
        var bHasIndependentActivator = false;
        for (var d = 0; d < dirs.length; d++) {
          var bnr = pair.r2 + dirs[d][0], bnc = pair.c2 + dirs[d][1];
          if (bnr < 0 || bnr >= maprow || bnc < 0 || bnc >= mapcol) continue;
          if (bnr === pair.r1 && bnc === pair.c1) continue; // 排除A本身
          var bns = spools[bnr] && spools[bnr][bnc];
          if (!bns || isObs(bns)) continue;
          var canReachNeighbor = canReachWithoutTwo(spools, maprow, mapcol, bnr, bnc, pair.r1, pair.c1, pair.r2, pair.c2);
          if (canReachNeighbor) {
            bHasIndependentActivator = true;
            break;
          }
        }
        
        if (!aHasIndependentActivator && !bHasIndependentActivator) {
          deadlocks.push({
            type: 'narrow_chain_deadlock', row: pair.r1, col: pair.c1,
            r2: pair.r2, c2: pair.c2,
            reason: '窄路锁链死锁：两端都无法通过独立路径被激活（所有激活路径都经过对方）'
          });
        } else if (!aHasIndependentActivator) {
          deadlocks.push({
            type: 'narrow_chain_deadlock', row: pair.r1, col: pair.c1,
            r2: pair.r2, c2: pair.c2,
            reason: '窄路锁链死锁：A端(' + pair.r1 + ',' + pair.c1 + ')没有独立激活来源，所有相邻格的路径都经过锁链对'
          });
        } else if (!bHasIndependentActivator) {
          deadlocks.push({
            type: 'narrow_chain_deadlock', row: pair.r2, col: pair.c2,
            r2: pair.r1, c2: pair.c1,
            reason: '窄路锁链死锁：B端(' + pair.r2 + ',' + pair.c2 + ')没有独立激活来源，所有相邻格的路径都经过锁链对'
          });
        }
      }
    }

    // === 第3.5步：多对锁链交叉依赖检测 ===
    // 场景：锁链A对的激活路径必须经过锁链B对的位置，而B对的激活路径也必须经过A对
    // 形成循环依赖→所有涉及的锁链对都无法被拾取→死锁
    // 
    // 关键修正：如果被依赖的锁链对自身可以独立解开（两端各有独立激活路径），
    // 那它会先被玩家拾取→路径被打通→不构成死锁。
    // 只有"自身也无法独立解开"的锁链对才构成真正的阻塞。
    if (chainPairs.length >= 2) {
      // 收集所有锁链格子
      var allChainCells = {}; // 'r,c' -> pairIndex
      for (var i = 0; i < chainPairs.length; i++) {
        allChainCells[chainPairs[i].r1 + ',' + chainPairs[i].c1] = i;
        allChainCells[chainPairs[i].r2 + ',' + chainPairs[i].c2] = i;
      }
      
      // 先判断每对锁链是否"自身可独立解开"
      // 条件：两端各自有一个邻居能绕过整个锁链对从第一行到达
      var pairCanSelfResolve = []; // [bool] 该对是否可以被独立解开
      for (var i = 0; i < chainPairs.length; i++) {
        var pair = chainPairs[i];
        if (unreachableSet[pair.r1 + ',' + pair.c1] || unreachableSet[pair.r2 + ',' + pair.c2]) {
          pairCanSelfResolve.push(false);
          continue;
        }
        
        // A端是否有独立激活来源（绕过整个锁链对）
        var aOk = false;
        for (var d = 0; d < dirs.length; d++) {
          var anr = pair.r1 + dirs[d][0], anc = pair.c1 + dirs[d][1];
          if (anr < 0 || anr >= maprow || anc < 0 || anc >= mapcol) continue;
          if (anr === pair.r2 && anc === pair.c2) continue;
          var ans = spools[anr] && spools[anr][anc];
          if (!ans || isObs(ans)) continue;
          if (canReachWithoutTwo(spools, maprow, mapcol, anr, anc, pair.r1, pair.c1, pair.r2, pair.c2)) {
            aOk = true; break;
          }
        }
        
        // B端是否有独立激活来源
        var bOk = false;
        for (var d = 0; d < dirs.length; d++) {
          var bnr = pair.r2 + dirs[d][0], bnc = pair.c2 + dirs[d][1];
          if (bnr < 0 || bnr >= maprow || bnc < 0 || bnc >= mapcol) continue;
          if (bnr === pair.r1 && bnc === pair.c1) continue;
          var bns = spools[bnr] && spools[bnr][bnc];
          if (!bns || isObs(bns)) continue;
          if (canReachWithoutTwo(spools, maprow, mapcol, bnr, bnc, pair.r1, pair.c1, pair.r2, pair.c2)) {
            bOk = true; break;
          }
        }
        
        pairCanSelfResolve.push(aOk && bOk);
      }
      
      // 对每对"自身无法独立解开"的锁链，检查它依赖哪些其他锁链对
      // dependsOn[i] = set of pair indices that pair i's path goes through
      var dependsOn = [];
      for (var i = 0; i < chainPairs.length; i++) {
        dependsOn.push({});
      }
      
      for (var i = 0; i < chainPairs.length; i++) {
        // 只对自身无法独立解开的锁链做依赖分析
        if (pairCanSelfResolve[i]) continue;
        
        var pair = chainPairs[i];
        if (unreachableSet[pair.r1 + ',' + pair.c1] || unreachableSet[pair.r2 + ',' + pair.c2]) continue;
        
        // 收集A端和B端的所有非对方邻居
        var neighborsToCheck = [];
        for (var d = 0; d < dirs.length; d++) {
          var anr = pair.r1 + dirs[d][0], anc = pair.c1 + dirs[d][1];
          if (anr < 0 || anr >= maprow || anc < 0 || anc >= mapcol) continue;
          if (anr === pair.r2 && anc === pair.c2) continue;
          var ans = spools[anr] && spools[anr][anc];
          if (ans && !isObs(ans)) neighborsToCheck.push({ row: anr, col: anc });
        }
        for (var d = 0; d < dirs.length; d++) {
          var bnr = pair.r2 + dirs[d][0], bnc = pair.c2 + dirs[d][1];
          if (bnr < 0 || bnr >= maprow || bnc < 0 || bnc >= mapcol) continue;
          if (bnr === pair.r1 && bnc === pair.c1) continue;
          var bns = spools[bnr] && spools[bnr][bnc];
          if (bns && !isObs(bns)) neighborsToCheck.push({ row: bnr, col: bnc });
        }
        
        for (var ni = 0; ni < neighborsToCheck.length; ni++) {
          var nb = neighborsToCheck[ni];
          var pathDeps = bfsPathDependencies(spools, maprow, mapcol, nb.row, nb.col, pair.r1, pair.c1, pair.r2, pair.c2, allChainCells, i);
          for (var dep in pathDeps) {
            // 只记录对"同样无法独立解开"的锁链对的依赖
            // 如果依赖的对可以自行解开，那它不构成阻塞
            if (!pairCanSelfResolve[parseInt(dep)]) {
              dependsOn[i][dep] = true;
            }
          }
        }
      }
      
      // 检测循环依赖：如果 i depends on j 且 j depends on i → 循环死锁
      var reportedCyclePairs = {};
      for (var i = 0; i < chainPairs.length; i++) {
        for (var j in dependsOn[i]) {
          j = parseInt(j);
          if (j === i) continue;
          if (dependsOn[j] && dependsOn[j][i]) {
            var cycleKey = Math.min(i, j) + '-' + Math.max(i, j);
            if (reportedCyclePairs[cycleKey]) continue;
            reportedCyclePairs[cycleKey] = true;
            
            var pi = chainPairs[i], pj = chainPairs[j];
            deadlocks.push({
              type: 'narrow_chain_deadlock',
              row: pi.r1, col: pi.c1, r2: pi.r2, c2: pi.c2,
              reason: '多对锁链循环死锁：(' + pi.r1 + ',' + pi.c1 + ')↔(' + pi.r2 + ',' + pi.c2 + ') 与 (' + pj.r1 + ',' + pj.c1 + ')↔(' + pj.r2 + ',' + pj.c2 + ') 互相依赖且都无法独立解开'
            });
          }
        }
        
        // 单向依赖也报（i无法独立解开，且唯一的路都被另一个无法独立解开的j阻塞）
        if (!pairCanSelfResolve[i]) {
          var depKeys = Object.keys(dependsOn[i]);
          if (depKeys.length > 0) {
            // 检查是否所有邻居路径都被阻塞（没有任何一个邻居能绕过所有依赖的锁链对）
            var pair = chainPairs[i];
            var allBlocked = true;
            var neighborsToCheck2 = [];
            for (var d = 0; d < dirs.length; d++) {
              var anr = pair.r1 + dirs[d][0], anc = pair.c1 + dirs[d][1];
              if (anr < 0 || anr >= maprow || anc < 0 || anc >= mapcol) continue;
              if (anr === pair.r2 && anc === pair.c2) continue;
              var ans = spools[anr] && spools[anr][anc];
              if (ans && !isObs(ans)) neighborsToCheck2.push({ row: anr, col: anc });
            }
            for (var d = 0; d < dirs.length; d++) {
              var bnr = pair.r2 + dirs[d][0], bnc = pair.c2 + dirs[d][1];
              if (bnr < 0 || bnr >= maprow || bnc < 0 || bnc >= mapcol) continue;
              if (bnr === pair.r1 && bnc === pair.c1) continue;
              var bns = spools[bnr] && spools[bnr][bnc];
              if (bns && !isObs(bns)) neighborsToCheck2.push({ row: bnr, col: bnc });
            }
            // 如果有任何邻居能不经过所有阻塞锁链到达→不是死锁
            for (var ni = 0; ni < neighborsToCheck2.length; ni++) {
              var nb = neighborsToCheck2[ni];
              if (canReachWithoutTwo(spools, maprow, mapcol, nb.row, nb.col, pair.r1, pair.c1, pair.r2, pair.c2)) {
                // 这个邻居本身可达，检查它是不是某个阻塞锁链的格子
                var isBlockedByDep = false;
                for (var dk = 0; dk < depKeys.length; dk++) {
                  var depIdx = parseInt(depKeys[dk]);
                  var dpair = chainPairs[depIdx];
                  if ((nb.row === dpair.r1 && nb.col === dpair.c1) || (nb.row === dpair.r2 && nb.col === dpair.c2)) {
                    isBlockedByDep = true; break;
                  }
                }
                if (!isBlockedByDep) { allBlocked = false; break; }
              }
            }
            // 没有在循环中已报告且确实所有路都被堵
            if (allBlocked && !reportedCyclePairs[i + '-' + depKeys[0]] && !reportedCyclePairs[depKeys[0] + '-' + i]) {
              var blockerPair = chainPairs[parseInt(depKeys[0])];
              deadlocks.push({
                type: 'narrow_chain_deadlock',
                row: pair.r1, col: pair.c1, r2: pair.r2, c2: pair.c2,
                reason: '锁链被阻塞：(' + pair.r1 + ',' + pair.c1 + ')↔(' + pair.r2 + ',' + pair.c2 + ') 的所有激活路径都被 (' + blockerPair.r1 + ',' + blockerPair.c1 + ')↔(' + blockerPair.r2 + ',' + blockerPair.c2 + ') 阻塞'
              });
            }
          }
        }
      }
    }

    // === 第四步：被完全封锁的格子 ===
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool || isObs(spool)) continue;
        if (spool.id <= 0) continue;
        var key = r + ',' + c;
        if (unreachableSet[key]) continue;

        var openDirs = 0;
        for (var d = 0; d < dirs.length; d++) {
          var nr = r + dirs[d][0], nc = c + dirs[d][1];
          if (nr < 0) { openDirs++; continue; } // 向上出界=开放
          if (nr >= maprow || nc < 0 || nc >= mapcol) continue;
          var ns = spools[nr] && spools[nr][nc];
          if (ns && !isObs(ns)) openDirs++;
        }

        if (openDirs === 0) {
          var alreadyReported = false;
          for (var di = 0; di < deadlocks.length; di++) {
            if (deadlocks[di].row === r && deadlocks[di].col === c) { alreadyReported = true; break; }
          }
          if (!alreadyReported) {
            deadlocks.push({ type: 'surrounded', row: r, col: c, reason: '四面被障碍/边界包围' });
          }
        }
      }
    }

    // === 第五步：孤立区域检测 ===
    // 找连通分量：如果某个连通分量内的所有球都是锁链球且配对在同一分量内
    // 且分量内没有非锁链球作为"启动器"，则该区域可能死锁
    var visited = {};
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool || isObs(spool) || spool.id <= 0) continue;
        var key = r + ',' + c;
        if (visited[key] || unreachableSet[key]) continue;
        if (dist[r][c] === -1) continue;
        
        // BFS找连通分量（只通过非障碍格连通）
        var component = [];
        var queue = [{ row: r, col: c }];
        visited[key] = true;
        while (queue.length > 0) {
          var cur = queue.shift();
          component.push(cur);
          for (var d = 0; d < dirs.length; d++) {
            var nr = cur.row + dirs[d][0], nc = cur.col + dirs[d][1];
            if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
            var nk = nr + ',' + nc;
            if (visited[nk]) continue;
            var ns = spools[nr] && spools[nr][nc];
            if (!ns || isObs(ns) || ns.id <= 0) continue;
            visited[nk] = true;
            queue.push({ row: nr, col: nc });
          }
        }
        
        // 检查这个分量是否能从第一行进入
        var hasEntry = false;
        for (var ci = 0; ci < component.length; ci++) {
          if (component[ci].row === 0) { hasEntry = true; break; }
          // 检查是否有邻居在第一行或邻居已被访问（可传播激活）
          for (var d = 0; d < dirs.length; d++) {
            var nr = component[ci].row + dirs[d][0];
            if (nr < 0) { hasEntry = true; break; } // 紧邻顶部=可从外部激活
          }
          if (hasEntry) break;
        }
        
        if (!hasEntry && component.length > 0) {
          // 无入口的连通分量=孤立区域
          for (var ci = 0; ci < component.length; ci++) {
            var alreadyReported = false;
            for (var di = 0; di < deadlocks.length; di++) {
              if (deadlocks[di].row === component[ci].row && deadlocks[di].col === component[ci].col) {
                alreadyReported = true; break;
              }
            }
            if (!alreadyReported) {
              deadlocks.push({
                type: 'isolated_region',
                row: component[ci].row, col: component[ci].col,
                reason: '所在连通区域无法从第一行进入（' + component.length + '格孤立区）'
              });
            }
          }
        }
      }
    }

    return deadlocks;
  }

  /**
   * 深度死锁检测：静态分析 + 快速求解器验证
   * 如果静态分析没发现死锁但关卡有锁链，跑一轮快速求解器确认
   * 返回增强的deadlocks数组
   */
  function checkDeadlocksDeep(spools, maprow, mapcol, blocks) {
    var deadlocks = checkDeadlocks(spools, maprow, mapcol);
    
    // 如果静态分析已发现死锁，直接返回
    if (deadlocks.length > 0) return deadlocks;
    
    // 检查是否有锁链球存在
    var hasChain = false;
    for (var r = 0; r < maprow && !hasChain; r++) {
      for (var c = 0; c < mapcol && !hasChain; c++) {
        var s = spools[r] && spools[r][c];
        if (!s) continue;
        var types = Array.isArray(s.type) ? s.type : [s.type];
        if (types.indexOf(5) !== -1) hasChain = true;
      }
    }
    
    // 没有锁链→不可能有锁链死锁
    if (!hasChain) return deadlocks;
    
    // 有锁链且静态分析通过→跑快速求解器验证
    // 如果有目标区数据才跑求解器
    if (!blocks || blocks.length === 0) return deadlocks;
    
    try {
      // 快速求解（用较短超时，只验证是否能通关）
      var result = analyzeOptimalSolution(spools, maprow, mapcol, blocks, 0);
      if (!result.completed) {
        // 求解失败→可能是死锁（也可能只是难度太高）
        // 再试一次不同种子
        var result2 = analyzeOptimalSolution(spools, maprow, mapcol, blocks, 5000);
        if (!result2.completed) {
          deadlocks.push({
            type: 'solver_deadlock',
            row: -1, col: -1,
            reason: '求解器验证失败：多次尝试均无法通关（进度:' + Math.max(result.progress, result2.progress) + '%），可能存在动态死锁'
          });
        }
      }
    } catch (e) {
      // 求解器出错不影响
    }
    
    return deadlocks;
  }

  /**
   * 检查targetCell是否"只能通过viaCell才能被激活传播到达"
   * 即：从第一行开始BFS激活传播，排除viaCell后，targetCell是否还能被到达
   * 这模拟了实际游戏中的激活传播路径
   */
  function isOnlyReachableVia(spools, maprow, mapcol, targetRow, targetCol, viaRow, viaCol) {
    // 从第一行开始模拟激活传播，排除viaCell
    var reached = {};
    var queue = [];
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    
    for (var c = 0; c < mapcol; c++) {
      var s = spools[0] && spools[0][c];
      if (!s || isObstacle(s)) continue;
      if (0 === viaRow && c === viaCol) continue;
      var key = '0,' + c;
      reached[key] = true;
      queue.push({ row: 0, col: c });
    }
    
    while (queue.length > 0) {
      var cur = queue.shift();
      for (var d = 0; d < dirs.length; d++) {
        var nr = cur.row + dirs[d][0], nc = cur.col + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        if (nr === viaRow && nc === viaCol) continue; // 排除via
        var nk = nr + ',' + nc;
        if (reached[nk]) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (!ns || isObstacle(ns)) continue;
        reached[nk] = true;
        queue.push({ row: nr, col: nc });
      }
    }
    
    // target 不在到达集中 = 只能经过via到达
    return !reached[targetRow + ',' + targetCol];
  }

  /**
   * BFS检查：能否不经过(exRow,exCol)从第一行到达(targetRow,targetCol)
   */
  function canReachWithout(spools, maprow, mapcol, targetRow, targetCol, exRow, exCol) {
    var visited = {};
    var queue = [];
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];

    for (var c = 0; c < mapcol; c++) {
      if (c === exCol && 0 === exRow) continue;
      var s = spools[0] && spools[0][c];
      if (s && !isObstacle(s)) {
        var key = '0,' + c;
        visited[key] = true;
        if (0 === targetRow && c === targetCol) return true;
        queue.push({ row: 0, col: c });
      }
    }

    while (queue.length > 0) {
      var curr = queue.shift();
      for (var d = 0; d < dirs.length; d++) {
        var nr = curr.row + dirs[d][0], nc = curr.col + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        if (nr === exRow && nc === exCol) continue;
        var nkey = nr + ',' + nc;
        if (visited[nkey]) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (!ns || isObstacle(ns)) continue;
        visited[nkey] = true;
        if (nr === targetRow && nc === targetCol) return true;
        queue.push({ row: nr, col: nc });
      }
    }
    return false;
  }

  /**
   * BFS检查：能否同时排除两个格子(ex1和ex2)，从第一行到达target
   * 用于锁链死锁检测：检查锁链对的邻居是否能绕过整个锁链对被到达
   */
  function canReachWithoutTwo(spools, maprow, mapcol, targetRow, targetCol, ex1Row, ex1Col, ex2Row, ex2Col) {
    var visited = {};
    var queue = [];
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];

    for (var c = 0; c < mapcol; c++) {
      if (0 === ex1Row && c === ex1Col) continue;
      if (0 === ex2Row && c === ex2Col) continue;
      var s = spools[0] && spools[0][c];
      if (s && !isObstacle(s)) {
        var key = '0,' + c;
        visited[key] = true;
        if (0 === targetRow && c === targetCol) return true;
        queue.push({ row: 0, col: c });
      }
    }

    while (queue.length > 0) {
      var curr = queue.shift();
      for (var d = 0; d < dirs.length; d++) {
        var nr = curr.row + dirs[d][0], nc = curr.col + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        if (nr === ex1Row && nc === ex1Col) continue;
        if (nr === ex2Row && nc === ex2Col) continue;
        var nkey = nr + ',' + nc;
        if (visited[nkey]) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (!ns || isObstacle(ns)) continue;
        visited[nkey] = true;
        if (nr === targetRow && nc === targetCol) return true;
        queue.push({ row: nr, col: nc });
      }
    }
    return false;
  }

  /**
   * BFS路径依赖分析：从第一行到target，排除自身锁链对(ex1,ex2)
   * 返回：到达target的所有路径是否必须经过其他锁链对的格子
   * 如果target完全不可达（排除自身后）→ 返回空（已在上层处理）
   * 如果所有路径都经过某个锁链对j的格子 → 返回 {j: true}
   * 
   * 简化算法：BFS排除自身格子，如果target可达，检查移除每个其他锁链对后是否还可达
   * 如果移除某对后不可达 → 该对是必经依赖
   */
  function bfsPathDependencies(spools, maprow, mapcol, targetRow, targetCol, ex1Row, ex1Col, ex2Row, ex2Col, allChainCells, selfIdx) {
    var deps = {};
    
    // 先检查排除自身后target是否可达
    if (!canReachWithoutTwo(spools, maprow, mapcol, targetRow, targetCol, ex1Row, ex1Col, ex2Row, ex2Col)) {
      return deps; // 自身排除后就不可达，不需要分析依赖
    }
    
    // 收集路径上经过的其他锁链对索引
    // 方法：对每个其他锁链对j，检查排除自身+j的所有4格后，target是否仍可达
    // 如果不可达 → j是必经依赖
    for (var cellKey in allChainCells) {
      var pairIdx = allChainCells[cellKey];
      if (pairIdx === selfIdx) continue;
      if (deps[pairIdx] !== undefined) continue; // 已检查过这对
      
      // 该锁链对的另一格
      var parts = cellKey.split(',');
      var cr = parseInt(parts[0]), cc = parseInt(parts[1]);
      
      // 找到该对的两个格子
      var otherPair = null;
      // 从allChainCells找同pairIdx的所有格子
      var pairCells = [];
      for (var ck in allChainCells) {
        if (allChainCells[ck] === pairIdx) pairCells.push(ck);
      }
      if (pairCells.length < 2) continue;
      
      var p1 = pairCells[0].split(','), p2 = pairCells[1].split(',');
      var j1r = parseInt(p1[0]), j1c = parseInt(p1[1]);
      var j2r = parseInt(p2[0]), j2c = parseInt(p2[1]);
      
      // 检查排除自身(ex1,ex2) + j的两格后，target是否可达
      var reachable = canReachWithoutFour(spools, maprow, mapcol, targetRow, targetCol,
        ex1Row, ex1Col, ex2Row, ex2Col, j1r, j1c, j2r, j2c);
      
      if (!reachable) {
        deps[pairIdx] = true; // 必须经过j对
      }
    }
    
    return deps;
  }

  /**
   * BFS：排除4个格子后检查target是否可达
   */
  function canReachWithoutFour(spools, maprow, mapcol, targetRow, targetCol, 
                               ex1r, ex1c, ex2r, ex2c, ex3r, ex3c, ex4r, ex4c) {
    var visited = {};
    var queue = [];
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    
    function isExcluded(r, c) {
      return (r === ex1r && c === ex1c) || (r === ex2r && c === ex2c) ||
             (r === ex3r && c === ex3c) || (r === ex4r && c === ex4c);
    }

    for (var c = 0; c < mapcol; c++) {
      if (isExcluded(0, c)) continue;
      var s = spools[0] && spools[0][c];
      if (s && !isObstacle(s)) {
        var key = '0,' + c;
        visited[key] = true;
        if (0 === targetRow && c === targetCol) return true;
        queue.push({ row: 0, col: c });
      }
    }

    while (queue.length > 0) {
      var curr = queue.shift();
      for (var d = 0; d < dirs.length; d++) {
        var nr = curr.row + dirs[d][0], nc = curr.col + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        if (isExcluded(nr, nc)) continue;
        var nkey = nr + ',' + nc;
        if (visited[nkey]) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (!ns || isObstacle(ns)) continue;
        visited[nkey] = true;
        if (nr === targetRow && nc === targetCol) return true;
        queue.push({ row: nr, col: nc });
      }
    }
    return false;
  }

  // ==================== 路线分析 ====================

  /**
   * 找出从顶部到底部的最优路线（考虑目标区消除逻辑）
   * 计算解锁最大目标区的最小消耗步数
   * 管道内排序也计入路线考量
   */
  function findPathsTopToBottom(spools, maprow, mapcol, blocks) {
    var dist = bfsFromTopRow(spools, maprow, mapcol);

    // 统计棋盘上每种颜色的位置和距离
    var colorPositions = {}; // colorId -> [{row, col, dist, source:'cell'|'pipe', pipeIndex}]
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool) continue;

        // 普通颜色格
        if (spool.id > 0 && !isObstacle(spool)) {
          var d = dist[r][c];
          if (d !== -1) {
            if (!colorPositions[spool.id]) colorPositions[spool.id] = [];
            colorPositions[spool.id].push({ row: r, col: c, dist: d, source: 'cell' });
          }
        }

        // 管道内颜色（按出管道顺序，第一个最先出来）
        if (YarnLevel.isPipeType(spool.type) && Array.isArray(spool.param)) {
          // 管道的距离 = 管道格相邻可达格的距离 + 1
          var pipeDist = -1;
          var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
          for (var dd = 0; dd < dirs.length; dd++) {
            var nr = r + dirs[dd][0];
            var nc = c + dirs[dd][1];
            if (nr >= 0 && nr < maprow && nc >= 0 && nc < mapcol && dist[nr][nc] !== -1) {
              if (pipeDist === -1 || dist[nr][nc] < pipeDist) pipeDist = dist[nr][nc];
            }
          }
          if (pipeDist !== -1) {
            for (var pi = 0; pi < spool.param.length; pi++) {
              var pid = spool.param[pi];
              if (pid > 0) {
                if (!colorPositions[pid]) colorPositions[pid] = [];
                // 管道内越深的颜色需要先消耗前面的才能出来
                colorPositions[pid].push({ row: r, col: c, dist: pipeDist + pi + 1, source: 'pipe', pipeIndex: pi });
              }
            }
          }
        }
      }
    }

    // 计算每种颜色的"消除代价"（凑齐3个的最小总距离）
    var colorCosts = []; // [{colorId, minCost, positions}]
    for (var cid in colorPositions) {
      var positions = colorPositions[cid];
      if (positions.length < 3) continue; // 不够3个无法消除
      // 按距离排序，取最近的3个
      positions.sort(function(a, b) { return a.dist - b.dist; });
      var cost = positions[0].dist + positions[1].dist + positions[2].dist;
      colorCosts.push({ colorId: parseInt(cid), minCost: cost, positions: positions.slice(0, 3) });
    }
    colorCosts.sort(function(a, b) { return a.minCost - b.minCost; });

    // 找底部行的可达格，按距离排序
    var bottomCells = [];
    for (var c = 0; c < mapcol; c++) {
      if (dist[maprow - 1][c] !== -1) {
        bottomCells.push({ row: maprow - 1, col: c, dist: dist[maprow - 1][c] });
      }
    }
    bottomCells.sort(function(a, b) { return a.dist - b.dist; });

    // 回溯找到2-3条路径
    var paths = [];
    var usedCells = {};
    var maxPaths = Math.min(3, bottomCells.length);

    for (var i = 0; i < maxPaths; i++) {
      var target = bottomCells[i];
      var path = backtrackPath(dist, spools, maprow, mapcol, target.row, target.col, usedCells);
      if (path.length > 0) {
        paths.push(path);
        for (var p = 0; p < path.length; p++) {
          usedCells[path[p].row + ',' + path[p].col] = true;
        }
      }
    }

    return { paths: paths, colorCosts: colorCosts };
  }

  /**
   * 从目标格回溯到起点的路径
   */
  function backtrackPath(dist, spools, maprow, mapcol, targetRow, targetCol, usedCells) {
    var path = [];
    var r = targetRow;
    var c = targetCol;
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (dist[r][c] > 0) {
      path.unshift({ row: r, col: c });
      var found = false;

      // 优先选择未使用的格子
      var candidates = [];
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0];
        var nc = c + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        if (dist[nr][nc] === dist[r][c] - 1) {
          var key = nr + ',' + nc;
          candidates.push({ row: nr, col: nc, used: !!usedCells[key] });
        }
      }

      // 优先未使用的
      candidates.sort(function(a, b) { return (a.used ? 1 : 0) - (b.used ? 1 : 0); });

      if (candidates.length > 0) {
        r = candidates[0].row;
        c = candidates[0].col;
        found = true;
      }

      if (!found) break;
    }

    // 添加起点
    if (dist[r][c] === 0) {
      path.unshift({ row: r, col: c });
    }

    return path;
  }

  /**
   * 找出关键瓶颈点：移除哪些障碍会让更多格子可达
   */
  function findBottlenecks(spools, maprow, mapcol) {
    var baseReach = checkReachability(spools, maprow, mapcol);
    var baseReachable = 0;
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (spool && !isObstacle(spool) && baseReach.distanceMap[r][c] !== -1) {
          baseReachable++;
        }
      }
    }

    var bottlenecks = [];

    // 对每个障碍格，模拟移除看能增加多少可达格
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool || !isObstacle(spool)) continue;

        // 临时移除障碍
        var backup = YarnLevel.deepClone(spool);
        spools[r][c] = { id: 0, type: 0, param: 0 };

        var newReach = checkReachability(spools, maprow, mapcol);
        var newReachable = 0;
        for (var rr = 0; rr < maprow; rr++) {
          for (var cc = 0; cc < mapcol; cc++) {
            var s = spools[rr] && spools[rr][cc];
            if (s && !isObstacle(s) && newReach.distanceMap[rr][cc] !== -1) {
              newReachable++;
            }
          }
        }

        var gain = newReachable - baseReachable;
        if (gain > 0) {
          bottlenecks.push({ row: r, col: c, gain: gain });
        }

        // 恢复
        spools[r][c] = backup;
      }
    }

    // 按增益排序，取前5个
    bottlenecks.sort(function(a, b) { return b.gain - a.gain; });
    return bottlenecks.slice(0, 5);
  }

  // ==================== 模拟消除分析 ====================

  /**
   * 分析最优玩法：贪心策略，每次消除距离最近的3个同色球
   * 返回：总步数、消除进度、暂存区最大占用
   */
  function analyzeOptimalPlay(spools, maprow, mapcol, blocks) {
    var BUFFER_LIMIT = 7;
    var dist = bfsFromTopRow(spools, maprow, mapcol);

    // 收集所有可用球
    var allBalls = [];
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool) continue;
        if (spool.id > 0 && !isObstacle(spool) && dist[r][c] !== -1) {
          allBalls.push({ row: r, col: c, colorId: spool.id, dist: dist[r][c], source: 'cell' });
        }
        if (YarnLevel.isPipeType(spool.type) && Array.isArray(spool.param)) {
          var pipeDist = -1;
          var pDirs = [[-1,0],[1,0],[0,-1],[0,1]];
          for (var d = 0; d < pDirs.length; d++) {
            var nr = r + pDirs[d][0], nc = c + pDirs[d][1];
            if (nr >= 0 && nr < maprow && nc >= 0 && nc < mapcol && dist[nr][nc] !== -1) {
              if (pipeDist === -1 || dist[nr][nc] < pipeDist) pipeDist = dist[nr][nc];
            }
          }
          if (pipeDist !== -1) {
            for (var pi = 0; pi < spool.param.length; pi++) {
              var pid = spool.param[pi];
              if (pid > 0) {
                allBalls.push({ row: r, col: c, colorId: pid, dist: pipeDist + pi + 1, source: 'pipe', pipeIndex: pi });
              }
            }
          }
        }
      }
    }

    // 构建目标区按列下落模型：每列一个数组，索引0=底部（当前露出）
    var targetColumns = []; // [col][stackIndex] = colorId
    var totalTargetPixels = 0;
    if (blocks && blocks.length > 0) {
      var bCols = blocks[0].length;
      for (var c = 0; c < bCols; c++) {
        var col = [];
        // 从底行到顶行构建栈（底部先消）
        for (var r = blocks.length - 1; r >= 0; r--) {
          var _bid = YarnLevel.getBlockId(blocks[r] && blocks[r][c]);
          if (_bid > 0) {
            col.push(_bid);
            totalTargetPixels++;
          }
        }
        targetColumns.push(col);
      }
    }
    var totalTargetSpools = Math.floor(totalTargetPixels / 3);

    // 尝试用一个球消除目标区：从左到右扫描各列底部，找同色消除最多3个
    // 返回消除数量（0=无法消除）
    function tryEliminate(colorId) {
      var eliminated = 0;
      for (var c = 0; c < targetColumns.length && eliminated < 3; c++) {
        if (targetColumns[c].length > 0 && targetColumns[c][0] === colorId) {
          targetColumns[c].shift(); // 消除底部，上面下落
          eliminated++;
        }
      }
      return eliminated;
    }

    // 检查一个颜色能消多少（不实际消除，只查询）
    function peekEliminate(colorId) {
      var count = 0;
      for (var c = 0; c < targetColumns.length && count < 3; c++) {
        if (targetColumns[c].length > 0 && targetColumns[c][0] === colorId) {
          count++;
        }
      }
      return count;
    }

    // 贪心模拟
    allBalls.sort(function(a, b) { return a.dist - b.dist; });

    var buffer = []; // 暂存区：[{colorId, ball}]
    var maxBuffer = 0;
    var totalSteps = 0;
    var eliminatedPixels = 0;
    var eliminatedSpools = 0;
    var cellSteps = [];
    var eliminationOrder = [];
    var remaining = allBalls.slice();

    while (remaining.length > 0) {
      // 选球：优先能消3个的 > 能消1-2个的 > 距离近的
      var bestIdx = -1;
      var bestElim = 0;
      var bestDist = Infinity;

      for (var i = 0; i < remaining.length; i++) {
        var ball = remaining[i];
        var elim = peekEliminate(ball.colorId);
        if (elim > bestElim || (elim === bestElim && ball.dist < bestDist)) {
          bestIdx = i; bestElim = elim; bestDist = ball.dist;
        }
      }

      if (bestIdx === -1) break;

      var chosen = remaining[bestIdx];
      var elimCount = peekEliminate(chosen.colorId);

      // 如果不能消且暂存区满了，尝试先释放暂存区
      if (elimCount === 0 && buffer.length >= BUFFER_LIMIT) {
        // 尝试释放暂存区中能消的球
        var freed = false;
        for (var bi = 0; bi < buffer.length; bi++) {
          var bufElim = peekEliminate(buffer[bi].colorId);
          if (bufElim > 0) {
            var done = tryEliminate(buffer[bi].colorId);
            eliminatedPixels += done;
            if (done >= 3) { // 球消完了，离开暂存区
              buffer.splice(bi, 1);
              eliminatedSpools++;
              freed = true;
              break;
            }
          }
        }
        if (!freed) break; // 真的卡死
        continue; // 释放后重新选球
      }

      // 不能消且暂存区没满，或者能消：取球
      remaining.splice(bestIdx, 1);
      totalSteps++;
      cellSteps.push({ row: chosen.row, col: chosen.col, step: totalSteps, source: chosen.source });

      if (elimCount > 0) {
        var actual = tryEliminate(chosen.colorId);
        eliminatedPixels += actual;
        if (actual >= 3) {
          // 球完全消耗，不占暂存区
          eliminatedSpools++;
        } else {
          // 部分消除，球进暂存区等后续
          buffer.push({ colorId: chosen.colorId });
        }
        eliminationOrder.push({
          colorId: chosen.colorId,
          colorName: YarnLevel.getColorName(chosen.colorId),
          dist: chosen.dist,
          step: totalSteps,
          pixelsEliminated: actual,
          progress: totalTargetSpools > 0 ? Math.min(100, Math.round(eliminatedSpools / totalTargetSpools * 100)) : 0
        });
      } else {
        // 完全不能消，进暂存区
        buffer.push({ colorId: chosen.colorId });
      }

      if (buffer.length > maxBuffer) maxBuffer = buffer.length;

      // 每步后检查暂存区的球是否因为其他消除导致新颜色露出而可以消了
      var changed = true;
      while (changed) {
        changed = false;
        for (var bi = buffer.length - 1; bi >= 0; bi--) {
          var bufElim = peekEliminate(buffer[bi].colorId);
          if (bufElim > 0) {
            var done = tryEliminate(buffer[bi].colorId);
            eliminatedPixels += done;
            // 简化：认为暂存区的球一旦能消就消完（不管是否消满3个）
            buffer.splice(bi, 1);
            eliminatedSpools++;
            changed = true;
          }
        }
      }
    }

    return {
      totalSteps: totalSteps,
      totalGroups: eliminatedSpools,
      totalTargetSpools: totalTargetSpools,
      eliminatedSpools: eliminatedSpools,
      eliminatedPixels: eliminatedPixels,
      maxBuffer: maxBuffer,
      bufferLimit: BUFFER_LIMIT,
      bufferFinal: buffer.length,
      progress: totalTargetSpools > 0 ? Math.round(eliminatedSpools / totalTargetSpools * 100) : 0,
      order: eliminationOrder,
      cellSteps: cellSteps
    };
  }

  /**
   * 分析最复杂路线：模拟最坏情况
   * 暂存区上限7格，超出=游戏失败
   * 模拟：玩家以最不优的顺序取球（轮流不同颜色），计算暂存区峰值和是否卡死
   */
  function analyzeHardestPlay(spools, maprow, mapcol, blocks) {
    var BUFFER_LIMIT = 7;
    var dist = bfsFromTopRow(spools, maprow, mapcol);

    // 收集所有可用球
    var allBalls = [];
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool) continue;
        if (spool.id > 0 && !isObstacle(spool) && dist[r][c] !== -1) {
          allBalls.push({ colorId: spool.id, dist: dist[r][c] });
        }
        if (YarnLevel.isPipeType(spool.type) && Array.isArray(spool.param)) {
          var pipeDist = -1;
          var pDirs = [[-1,0],[1,0],[0,-1],[0,1]];
          for (var d = 0; d < pDirs.length; d++) {
            var nr = r + pDirs[d][0], nc = c + pDirs[d][1];
            if (nr >= 0 && nr < maprow && nc >= 0 && nc < mapcol && dist[nr][nc] !== -1) {
              if (pipeDist === -1 || dist[nr][nc] < pipeDist) pipeDist = dist[nr][nc];
            }
          }
          if (pipeDist !== -1) {
            for (var pi = 0; pi < spool.param.length; pi++) {
              var pid = spool.param[pi];
              if (pid > 0) {
                allBalls.push({ colorId: pid, dist: pipeDist + pi + 1 });
              }
            }
          }
        }
      }
    }

    // 构建目标区按列下落模型
    var targetColumns = [];
    var totalTargetPixels = 0;
    if (blocks && blocks.length > 0) {
      var bCols = blocks[0].length;
      for (var c = 0; c < bCols; c++) {
        var col = [];
        for (var r = blocks.length - 1; r >= 0; r--) {
          var _bid = YarnLevel.getBlockId(blocks[r] && blocks[r][c]);
          if (_bid > 0) {
            col.push(_bid);
            totalTargetPixels++;
          }
        }
        targetColumns.push(col);
      }
    }
    var totalTargetSpools = Math.floor(totalTargetPixels / 3);

    function peekElim(colorId) {
      var count = 0;
      for (var c = 0; c < targetColumns.length && count < 3; c++) {
        if (targetColumns[c].length > 0 && targetColumns[c][0] === colorId) count++;
      }
      return count;
    }

    function doElim(colorId) {
      var eliminated = 0;
      for (var c = 0; c < targetColumns.length && eliminated < 3; c++) {
        if (targetColumns[c].length > 0 && targetColumns[c][0] === colorId) {
          targetColumns[c].shift();
          eliminated++;
        }
      }
      return eliminated;
    }

    // 最坏顺序：优先取不能消除的球（距离远、目标区底部没有该色）
    allBalls.sort(function(a, b) {
      var aElim = peekElim(a.colorId);
      var bElim = peekElim(b.colorId);
      // 优先取不能消的（aElim=0排前面），同类按距离远的优先
      if (aElim === 0 && bElim > 0) return -1;
      if (bElim === 0 && aElim > 0) return 1;
      return b.dist - a.dist; // 距离远的先取
    });

    var buffer = [];
    var maxBuffer = 0;
    var totalSteps = 0;
    var eliminatedSpools = 0;
    var eliminatedPixels = 0;
    var failed = false;

    for (var i = 0; i < allBalls.length; i++) {
      var ball = allBalls[i];
      var elimCount = peekElim(ball.colorId);

      // 检查暂存区是否满了
      if (elimCount === 0 && buffer.length >= BUFFER_LIMIT) {
        // 尝试释放暂存区
        var freed = false;
        for (var bi = 0; bi < buffer.length; bi++) {
          var bufElim = peekElim(buffer[bi].colorId);
          if (bufElim > 0) {
            var done = doElim(buffer[bi].colorId);
            eliminatedPixels += done;
            buffer.splice(bi, 1);
            eliminatedSpools++;
            freed = true;
            break;
          }
        }
        if (!freed) { failed = true; break; }
      }

      totalSteps++;

      if (elimCount > 0) {
        var actual = doElim(ball.colorId);
        eliminatedPixels += actual;
        if (actual >= 3) {
          eliminatedSpools++;
        } else {
          buffer.push({ colorId: ball.colorId });
        }
      } else {
        buffer.push({ colorId: ball.colorId });
      }

      if (buffer.length > maxBuffer) maxBuffer = buffer.length;

      // 检查暂存区释放
      var changed = true;
      while (changed) {
        changed = false;
        for (var bi = buffer.length - 1; bi >= 0; bi--) {
          if (peekElim(buffer[bi].colorId) > 0) {
            var done = doElim(buffer[bi].colorId);
            eliminatedPixels += done;
            buffer.splice(bi, 1);
            eliminatedSpools++;
            changed = true;
          }
        }
      }
    }

    return {
      totalSteps: totalSteps,
      maxBuffer: maxBuffer,
      bufferLimit: BUFFER_LIMIT,
      bufferOverflow: failed,
      totalGroups: eliminatedSpools,
      totalTargetSpools: totalTargetSpools,
      eliminatedSpools: eliminatedSpools,
      eliminatedPixels: eliminatedPixels,
      progress: totalTargetSpools > 0 ? Math.round(eliminatedSpools / totalTargetSpools * 100) : 0
    };
  }

  // ==================== 反推最优解法（目标驱动，最低平均暂存） ====================

  /**
   * 最优解法：从输出端目标反推棋盘取球顺序
   * 
   * 目标：找到一个取球顺序，使得100%完成进度时平均暂存占用最低
   * 
   * 游戏规则：
   * - 玩家从棋盘拾取线轴，线轴进入暂存区（占1格，上限6格）
   * - 线轴在暂存区自动匹配输出端第一行（从左到右扫描同色）
   * - 每消一个像素，该列下移露出新颜色，线轴重新从第1列扫描
   * - 消满3个像素 = 订单完成，线轴离开暂存区
   * - 输出端变化时，暂存区所有线轴自动重新尝试匹配
   * 
   * 暂存占用统计：每步结束后（放入线轴+结算匹配完成后），统计暂存区线轴数/6
   * 平均暂存 = 所有步的暂存占用之和 / 总步数
   * 
   * 算法策略（全局最优贪心）：
   * 对每个候选球，模拟放入后的暂存状态，选择使后续平均暂存最低的球
   */
  function analyzeOptimalSolution(spools, maprow, mapcol, blocks, seedOffset) {
    var BUFFER_LIMIT = 7;
    seedOffset = seedOffset || 0;

    // 第1轮：无噪声确定性求解（最快，大多数关卡一次通关）
    var best = runSolver3Step(spools, maprow, mapcol, blocks, BUFFER_LIMIT, 0, 1 + seedOffset, false);
    if (best.completed) return best;

    // 未通关 → 多轮带随机扰动重试（回溯），任一轮通关立即返回；否则取进度最高的
    var retryConfigs = [
      { noise: 0.3, seed: 17 },
      { noise: 0.6, seed: 53 },
      { noise: 0.9, seed: 101 },
      { noise: 1.2, seed: 211 },
      { noise: 0.5, seed: 307 },
      { noise: 1.5, seed: 401 },
      { noise: 2.0, seed: 599 },
      { noise: 1.0, seed: 733 }
    ];
    for (var i = 0; i < retryConfigs.length; i++) {
      var cfg = retryConfigs[i];
      var r = runSolver3Step(spools, maprow, mapcol, blocks, BUFFER_LIMIT, cfg.noise, cfg.seed + seedOffset, false);
      if (r.completed) {
        console.log('[Solver3] 回溯第' + (i + 1) + '轮通关 (noise=' + cfg.noise + ')');
        return r;
      }
      if (r.eliminatedSpools > best.eliminatedSpools) best = r;
    }
    console.log('[Solver3] 多轮回溯后仍未通关，最佳进度=' + best.progress + '%');
    return best;
  }

  // 玩家视角求解器：信息受限——问号激活后才知色、管道球释放到出口才可见。
  // 单步贪心（不偷看未来揭示）+ 暂存保护；暂存超上限即死亡。
  // 反复尝试（每次换不同随机倾向，模拟玩家换思路重玩）直到通关，
  // 记录"通关所需尝试次数" attempts 作为玩家难度参考。
  // ── 单档玩家求解：反复尝试直到通关，记录尝试次数（失败重来）──────────────
  function runPlayerTier(spools, maprow, mapcol, blocks, tierOpts, maxAttempts, seedOffset) {
    var BUFFER_LIMIT = 7;
    seedOffset = seedOffset || 0;
    var attempts = 0;
    var best = null;
    for (var a = 0; a < maxAttempts; a++) {
      attempts++;
      var noise = a === 0 ? 0 : Math.min(0.3 + a * 0.12, 2.5);
      var seed = 1 + a * 37 + seedOffset;
      var r = runSolver3Step(spools, maprow, mapcol, blocks, BUFFER_LIMIT, noise, seed, tierOpts);
      if (r.completed) {
        r.attempts = attempts;
        return r;
      }
      if (!best || r.eliminatedSpools > best.eliminatedSpools) best = r;
    }
    best.attempts = attempts;
    best.attemptsCapped = true;
    return best;
  }

  // ── 三档玩家配置 ───────────────────────────────────────────────
  // 都信息受限；都在暂存压力大(>=4)时提升推理深度。
  // misclickRate: 每步误触概率（着急快速点击/近色看错导致放无用球）。
  //   误触只在暂存不高时发生（着急快点），且只放"当前消不掉"的球→临时加压，后续可能被消。
  // maxAttempts: 失败重玩上限——菜鸟易失误重玩多，高手少失误重玩少。
  var PLAYER_TIERS = [
    // 1 菜鸟：常态1步纯贪心，仅压力大时才推理(2步)；不均匀管道；误触最多；重玩最多
    { key: 'novice', name: '菜鸟', weight: 0.30, maxAttempts: 12,
      opts: { infoLimited: true, lookahead: 1, pressureLookahead: 2, evenPipe: false, dieOnOverflow: true, misclickRate: 0.08 } },
    // 2 中级：常态2步推理，压力大时3步；不均匀管道
    { key: 'mid', name: '中级', weight: 0.40, maxAttempts: 8,
      opts: { infoLimited: true, lookahead: 2, pressureLookahead: 3, evenPipe: false, dieOnOverflow: true, misclickRate: 0.05 } },
    // 3 高手：常态3步前瞻，压力大也3步；均匀取管道；误触最少；重玩最少
    { key: 'strong', name: '高手', weight: 0.30, maxAttempts: 4,
      opts: { infoLimited: true, lookahead: 3, pressureLookahead: 3, evenPipe: true, dieOnOverflow: true, misclickRate: 0.025 } }
  ];

  // ── 单档玩家：重复跑 REPEAT 遍取均值（降低单次随机波动）──────────────
  var TIER_REPEAT = 3;
  function runPlayerTierAvg(spools, maprow, mapcol, blocks, tierOpts, maxAttempts, seedBase) {
    var runs = [];
    for (var k = 0; k < TIER_REPEAT; k++) {
      runs.push(runPlayerTier(spools, maprow, mapcol, blocks, tierOpts, maxAttempts, seedBase + k * 7919));
    }
    function avg(f) { var s = 0; for (var i = 0; i < runs.length; i++) s += f(runs[i]); return s / runs.length; }
    function rnd(x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
    // 以最后一次（或任意一次）作为展示主体的 pickOrder/history；指标取均值
    var base = runs[runs.length - 1];

    // 滞留分段均值（跨重复求平均，再找峰值段）
    var BANDS = 10;
    var bandAcc = new Array(BANDS), bandN = new Array(BANDS);
    for (var bi = 0; bi < BANDS; bi++) { bandAcc[bi] = 0; bandN[bi] = 0; }
    for (var ri = 0; ri < runs.length; ri++) {
      var rb = runs[ri].residenceByBand || [];
      for (var bj = 0; bj < rb.length && bj < BANDS; bj++) {
        if (rb[bj].count > 0) { bandAcc[bj] += rb[bj].avgResidence; bandN[bj]++; }
      }
    }
    var residenceByBand = [], peakIdx = -1, peakAvg = -1;
    for (var bk = 0; bk < BANDS; bk++) {
      var a = bandN[bk] > 0 ? bandAcc[bk] / bandN[bk] : 0;
      residenceByBand.push({ band: (bk*10)+'-'+((bk+1)*10)+'%', avgResidence: rnd(a,2), count: bandN[bk] });
      if (bandN[bk] > 0 && a > peakAvg) { peakAvg = a; peakIdx = bk; }
    }

    // ── 3遍"按球暂存曲线"平均（用于稳定的合格判定，降低单遍随机误触扰动）──
    var N0 = base.totalTargetSpools || 0;
    var ballCurveAvg = null, ballResAvg = null;
    if (N0 > 0) {
      var accC = new Array(N0), accR = new Array(N0), cnt = 0;
      for (var z = 0; z < N0; z++) { accC[z] = 0; accR[z] = 0; }
      for (var ri2 = 0; ri2 < runs.length; ri2++) {
        var bc = _ballCurveOf(runs[ri2]);
        if (bc.curve0 && bc.curve0.length === N0) {
          for (var z2 = 0; z2 < N0; z2++) { accC[z2] += bc.curve0[z2]; accR[z2] += (bc.res0 ? bc.res0[z2] : 0); }
          cnt++;
        }
      }
      if (cnt > 0) {
        ballCurveAvg = new Array(N0); ballResAvg = new Array(N0);
        for (var z3 = 0; z3 < N0; z3++) {
          ballCurveAvg[z3] = parseFloat((accC[z3] / cnt).toFixed(3));
          ballResAvg[z3] = parseFloat((accR[z3] / cnt).toFixed(3));
        }
      }
    }

    return {
      completed: avg(function(r){ return r.completed ? 1 : 0; }) >= 0.5,
      passRate: rnd(avg(function(r){ return r.completed ? 100 : 0; }), 0),
      totalSteps: Math.round(avg(function(r){ return r.totalSteps; })),
      totalTargetSpools: base.totalTargetSpools,
      eliminatedSpools: base.eliminatedSpools,
      progress: Math.round(avg(function(r){ return r.progress; })),
      maxBuffer: rnd(avg(function(r){ return r.maxBuffer; }), 1),
      avgBuffer: rnd(avg(function(r){ return r.avgBuffer; }), 2),
      avgBufferRatio: rnd(avg(function(r){ return r.avgBufferRatio; }), 1),
      attempts: rnd(avg(function(r){ return r.attempts || 0; }), 1),
      misclicks: rnd(avg(function(r){ return r.misclicks || 0; }), 1),
      avgResidence: rnd(avg(function(r){ return r.avgResidence || 0; }), 2),
      avgRawResidence: rnd(avg(function(r){ return r.avgRawResidence || 0; }), 2),
      maxResidence: Math.round(avg(function(r){ return r.maxResidence || 0; })),
      residenceByBand: residenceByBand,
      peakResidenceBand: peakIdx >= 0 ? residenceByBand[peakIdx].band : '-',
      peakResidenceAvg: rnd(peakAvg < 0 ? 0 : peakAvg, 2),
      bufferLimit: 7,
      bufferFinal: base.bufferFinal,
      stepBufferHistory: base.stepBufferHistory,
      stepElimHistory: base.stepElimHistory,
      stepResidenceHistory: base.stepResidenceHistory,
      pickOrder: base.pickOrder,
      ballCurveAvg: ballCurveAvg,   // 3遍按球平均曲线（合格判定用）
      ballResAvg: ballResAvg,
      runs: runs,                   // 保留3遍原始解（供挑选"最好的一遍"导出；仅内存，不序列化）
      repeat: TIER_REPEAT
    };
  }

  function findPlayerTierDef(tierKey) {
    for (var i = 0; i < PLAYER_TIERS.length; i++) {
      if (PLAYER_TIERS[i].key === tierKey) return { def: PLAYER_TIERS[i], index: i };
    }
    return null;
  }

  function analyzePlayerTier(spools, maprow, mapcol, blocks, tierKey, seedOffset) {
    seedOffset = seedOffset || 0;
    var found = findPlayerTierDef(tierKey);
    if (!found) return null;
    return runPlayerTierAvg(
      spools,
      maprow,
      mapcol,
      blocks,
      found.def.opts,
      found.def.maxAttempts,
      seedOffset + 200000 + found.index * 100000
    );
  }

  function composePlayerTierResult(tierResults) {
    tierResults = tierResults || {};
    function rnd(x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
    function wavg(f) {
      var s = 0, w = 0;
      for (var wi = 0; wi < PLAYER_TIERS.length; wi++) {
        var td = PLAYER_TIERS[wi];
        var tr = tierResults[td.key];
        if (!tr) continue;
        s += td.weight * f(tr);
        w += td.weight;
      }
      return w > 0 ? s / w : 0;
    }

    var routeBase = tierResults.mid || tierResults.strong || tierResults.novice;
    if (!routeBase) return null;
    return {
      totalSteps: Math.round(wavg(function(r){ return r.totalSteps; })),
      totalTargetSpools: routeBase.totalTargetSpools,
      eliminatedSpools: Math.round(wavg(function(r){ return r.eliminatedSpools; })),
      progress: Math.round(wavg(function(r){ return r.progress; })),
      maxBuffer: rnd(wavg(function(r){ return r.maxBuffer; }), 1),
      avgBuffer: rnd(wavg(function(r){ return r.avgBuffer; }), 2),
      avgBufferRatio: rnd(wavg(function(r){ return r.avgBufferRatio; }), 1),
      bufferLimit: 7,
      bufferFinal: routeBase.bufferFinal,
      stepBufferHistory: routeBase.stepBufferHistory,
      stepElimHistory: routeBase.stepElimHistory,
      stepResidenceHistory: routeBase.stepResidenceHistory,
      pickOrder: routeBase.pickOrder,
      completed: wavg(function(r){ return r.completed ? 1 : 0; }) >= 0.5,
      passRate: rnd(wavg(function(r){ return r.passRate || 0; }), 0),
      attempts: rnd(wavg(function(r){ return r.attempts || 0; }), 1),
      misclicks: rnd(wavg(function(r){ return r.misclicks || 0; }), 1),
      avgResidence: rnd(wavg(function(r){ return r.avgResidence || 0; }), 2),
      avgRawResidence: rnd(wavg(function(r){ return r.avgRawResidence || 0; }), 2),
      maxResidence: Math.round(wavg(function(r){ return r.maxResidence || 0; })),
      residenceByBand: routeBase.residenceByBand,
      peakResidenceBand: routeBase.peakResidenceBand,
      peakResidenceAvg: routeBase.peakResidenceAvg,
      validationErrors: [],
      solverVersion: 'PlayerTiersLazy',
      playerMode: true,
      repeat: TIER_REPEAT,
      tiers: tierResults
    };
  }

  // ── 生产审核基准求解：按 auditTier 跑单档作为审核基准线（3遍取均值）──────────────────
  // auditTier 缺省='strong'(高手)，与原行为完全一致；可切 'novice'(菜鸟)/'mid'(中级)。
  function analyzePlayerSolution(spools, maprow, mapcol, blocks, seedOffset, auditTier) {
    seedOffset = seedOffset || 0;
    auditTier = auditTier || 'strong';
    var found = findPlayerTierDef(auditTier);
    if (!found) { auditTier = 'strong'; found = findPlayerTierDef('strong'); }
    var tierDef = found.def;
    // 注意：高手档保持原 seed(seedOffset + 200000) 不变，确保既有高手审核结果可复现
    var baseResult = runPlayerTierAvg(spools, maprow, mapcol, blocks, tierDef.opts, tierDef.maxAttempts, seedOffset + 200000);
    // 从3遍里挑"最好的一遍"作为导出/展示解法（通关、个体符合优先、前期5%窗均值最低）
    baseResult.bestRun = _selectBestRun(baseResult.runs, auditTier);
    if (baseResult.runs) delete baseResult.runs; // 释放3遍原始解，避免内存膨胀（曲线均值/最好遍已留存）

    function rnd(x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }

    var tiersObj = {};
    tiersObj[auditTier] = baseResult;
    var combined = {
      totalSteps: baseResult.totalSteps,
      totalTargetSpools: baseResult.totalTargetSpools,
      eliminatedSpools: baseResult.eliminatedSpools,
      progress: baseResult.progress,
      maxBuffer: baseResult.maxBuffer,
      avgBuffer: baseResult.avgBuffer,
      avgBufferRatio: baseResult.avgBufferRatio,
      bufferLimit: 7,
      bufferFinal: baseResult.bufferFinal,
      stepBufferHistory: baseResult.stepBufferHistory,
      stepElimHistory: baseResult.stepElimHistory,
      stepResidenceHistory: baseResult.stepResidenceHistory,
      pickOrder: baseResult.pickOrder,
      completed: baseResult.completed,
      passRate: baseResult.passRate,
      attempts: baseResult.attempts,
      avgResidence: baseResult.avgResidence,
      avgRawResidence: baseResult.avgRawResidence,
      maxResidence: baseResult.maxResidence,
      residenceByBand: baseResult.residenceByBand,
      peakResidenceBand: baseResult.peakResidenceBand,
      peakResidenceAvg: baseResult.peakResidenceAvg,
      validationErrors: [],
      solverVersion: auditTier === 'strong' ? 'StrongOnly' : ('AuditTier:' + auditTier),
      auditTier: auditTier,
      playerMode: true,
      repeat: TIER_REPEAT,
      tiers: tiersObj
    };
    return combined;
  }

  // ── 网页展示用：恢复菜鸟/中级/高手三档路线，不影响生产审核 StrongOnly 接口 ─────────────
  function analyzePlayerSolutionAllTiers(spools, maprow, mapcol, blocks, seedOffset) {
    seedOffset = seedOffset || 0;
    var tierResults = {};
    for (var ti = 0; ti < PLAYER_TIERS.length; ti++) {
      var tier = PLAYER_TIERS[ti];
      tierResults[tier.key] = analyzePlayerTier(spools, maprow, mapcol, blocks, tier.key, seedOffset);
    }

    var combined = composePlayerTierResult(tierResults);
    if (combined) combined.solverVersion = 'PlayerTiersUI';
    return combined;
  }

  // =========================================================================
  // 大像素版 3步前瞻求解器（普通三步算法 + 暂存保护）
  // - 无黑块、无通道/窄路逻辑
  // - 每个线轴消除量 = 自身 count（订单量，48上下浮动；旧关卡回退3）
  // - 暂存上限 7
  // 策略：对每个可取球展开3步搜索树，计算3步总分，选总分最高路径的第1步；
  //       暂存安全检查作为否决权，过滤会导致暂存溢出且无出路的选择。
  // =========================================================================
  function runSolver3Step(spools, maprow, mapcol, blocks, BUFFER_LIMIT, noise, seed, opts) {
    var startTime = Date.now();
    var TIMEOUT_MS = 20000;
    BUFFER_LIMIT = BUFFER_LIMIT || 7;
    noise = noise || 0;

    // opts: 玩家档位配置；缺省（或 true）= 全知最优版
    // {
    //   infoLimited:  信息受限（问号激活才知色、管道仅出口可见）
    //   lookahead:    常态前瞻深度 1/2/3
    //   pressureLookahead: 暂存压力大(>=4)时提升到的前瞻深度
    //   evenPipe:     是否均匀取管道
    //   dieOnOverflow:暂存超7是否判死亡（玩家档true）
    // }
    if (opts === true) opts = { infoLimited: true, lookahead: 1, pressureLookahead: 3, evenPipe: false, dieOnOverflow: true };
    if (!opts) opts = { infoLimited: false, lookahead: 3, pressureLookahead: 3, evenPipe: true, dieOnOverflow: false, expand: true };
    var playerMode = !!opts.infoLimited;
    var LOOKAHEAD = opts.lookahead || (playerMode ? 1 : 3);
    var PRESSURE_LOOKAHEAD = opts.pressureLookahead || 3;
    var EVEN_PIPE = !!opts.evenPipe;
    var EXPAND = !!opts.expand;   // 全局规划：拓展棋盘可用球+颜色丰富度（全知最优版开启）
    var DIE_ON_OVERFLOW = (opts.dieOnOverflow !== undefined) ? !!opts.dieOnOverflow : playerMode;
    var MISCLICK_RATE = opts.misclickRate || 0;

    // 简单伪随机数生成器（用于扰动评分，支持多轮重试）
    var _rngState = (seed || 1) >>> 0;
    function rng() {
      _rngState = (_rngState * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (_rngState >>> 0) / 4294967296;
    }

    function buildTargetColumns(blks) {
      var cols = [];
      var totalPixels = 0;
      if (blks && blks.length > 0) {
        var bCols = blks[0].length;
        for (var c = 0; c < bCols; c++) {
          var col = [];
          for (var r = blks.length - 1; r >= 0; r--) {
            var bid = YarnLevel.getBlockId(blks[r] && blks[r][c]);
            if (bid > 0) { col.push(bid); totalPixels++; }
          }
          cols.push(col);
        }
      }
      return { columns: cols, totalPixels: totalPixels };
    }

    var targetInfo = buildTargetColumns(blocks);
    var totalTargetPixels = targetInfo.totalPixels;
    // 共享的不可变目标列（全程只建一次）；各状态只持有 head 指针数组 + 剩余计数。
    var SHARED_COLS = targetInfo.columns;        // [col][idx] = colorId
    var NUM_COLS = SHARED_COLS.length;
    var COL_LEN = [];
    for (var ci0 = 0; ci0 < NUM_COLS; ci0++) COL_LEN.push(SHARED_COLS[ci0].length);
    var dist = bfsFromTopRow(spools, maprow, mapcol);

    var totalSpoolCount = 0;
    for (var r0 = 0; r0 < maprow; r0++) {
      for (var c0 = 0; c0 < mapcol; c0++) {
        var sp0 = spools[r0] && spools[r0][c0];
        if (!sp0) continue;
        if (sp0.id > 0 && !YarnLevel.isPipeType(sp0.type)) totalSpoolCount++;
        if (YarnLevel.isPipeType(sp0.type) && Array.isArray(sp0.param)) {
          for (var pp0 = 0; pp0 < sp0.param.length; pp0++) {
            if (YarnLevel.getPipeItemId(sp0.param[pp0]) > 0) totalSpoolCount++;
          }
        }
      }
    }
    var totalTargetSpools = totalSpoolCount;

    function SolverState() {
      this.activated = {};
      this.picked = {};
      this.frozen = {};
      this.occupiedCells = {};
      this.buffer = [];
      this.targetHeads = [];      // 每列已消除到的下标（栈顶指针）
      this.targetRemaining = 0;   // 目标区剩余未消像素数
      this.pipeInfos = [];
      this.pipeReleasedBalls = [];
      this.remaining = [];
      this.steps = 0;
      this.eliminatedSpools = 0;
      this.pickOrder = [];
      this.stepBufferHistory = [];
      this.stepElimHistory = [];  // 每步结算后累计完成球数（用于按球数插值压力曲线）
      this.stepResidenceHistory = [];  // 每步结算后暂存球的平均滞留步数（用于滞留闸门）
      this.residences = [];       // 每个完成球的滞留情况 [{residence, progressPct}]
    }

    SolverState.prototype.clone = function() {
      var s = new SolverState();
      var k, i;
      for (k in this.activated) s.activated[k] = true;
      for (k in this.picked) s.picked[k] = true;
      for (k in this.frozen) s.frozen[k] = { activated: this.frozen[k].activated, thawProgress: this.frozen[k].thawProgress };
      for (k in this.occupiedCells) s.occupiedCells[k] = true;
      for (i = 0; i < this.buffer.length; i++) {
        s.buffer.push({ colorId: this.buffer[i].colorId, progress: this.buffer[i].progress, need: this.buffer[i].need, bornStep: this.buffer[i].bornStep, bufSum: this.buffer[i].bufSum, bufSteps: this.buffer[i].bufSteps });
      }
      s.targetHeads = this.targetHeads.slice();   // 只复制指针数组（~70整数），不复制4900元素
      s.targetRemaining = this.targetRemaining;
      for (i = 0; i < this.pipeInfos.length; i++) {
        var p = this.pipeInfos[i];
        s.pipeInfos.push({ row: p.row, col: p.col, exitRow: p.exitRow, exitCol: p.exitCol, param: p.param, nextRelease: p.nextRelease });
      }
      for (i = 0; i < this.pipeReleasedBalls.length; i++) {
        var prb = this.pipeReleasedBalls[i];
        s.pipeReleasedBalls.push({ row: prb.row, col: prb.col, colorId: prb.colorId, count: prb.count, pipeRow: prb.pipeRow, pipeCol: prb.pipeCol, pipeIndex: prb.pipeIndex });
      }
      for (i = 0; i < this.remaining.length; i++) {
        var rb = this.remaining[i];
        s.remaining.push({ row: rb.row, col: rb.col, colorId: rb.colorId, count: rb.count, dist: rb.dist, frozen: rb.frozen, chain: rb.chain });
      }
      s.steps = this.steps;
      s.eliminatedSpools = this.eliminatedSpools;
      s.pickOrder = this.pickOrder.slice();
      s.stepBufferHistory = this.stepBufferHistory.slice();
      s.stepElimHistory = this.stepElimHistory.slice();
      s.stepResidenceHistory = this.stepResidenceHistory.slice();
      s.residences = this.residences.slice();
      return s;
    };

    function createInitialState() {
      var state = new SolverState();
      state.targetHeads = [];
      for (var hi = 0; hi < NUM_COLS; hi++) state.targetHeads.push(0);
      state.targetRemaining = totalTargetPixels;

      for (var c = 0; c < mapcol; c++) {
        var s = spools[0] && spools[0][c];
        if (s && !isObstacle(s)) state.activated['0,' + c] = true;
      }

      for (var r = 0; r < maprow; r++) {
        for (var cc = 0; cc < mapcol; cc++) {
          var sp = spools[r] && spools[r][cc];
          if (!sp) continue;
          var key = r + ',' + cc;
          if (sp.id > 0 && !isObstacle(sp)) {
            state.occupiedCells[key] = true;
            var types = Array.isArray(sp.type) ? sp.type : (sp.type === 0 ? [] : [sp.type]);
            var isFrozen = types.indexOf(4) !== -1;
            var isChain = types.indexOf(5) !== -1;
            state.remaining.push({
              row: r, col: cc, colorId: sp.id, count: YarnLevel.getSpoolCount(sp),
              dist: dist[r][cc], frozen: isFrozen, chain: isChain
            });
            // 第一行冰块：init即激活，但全局也需4步解冻 → thawProgress从-1起步
            if (isFrozen) state.frozen[key] = { activated: !!state.activated[key], thawProgress: (r === 0 ? -1 : 0) };
          }
          if (YarnLevel.isPipeType(sp.type) && Array.isArray(sp.param) && sp.param.length > 0) {
            var dir = YarnLevel.getPipeDirection(sp.type);
            var exitR = r, exitC = cc;
            if (dir === 11) exitR = r - 1;
            else if (dir === 12) exitC = cc + 1;
            else if (dir === 13) exitR = r + 1;
            else if (dir === 14) exitC = cc - 1;
            state.pipeInfos.push({ row: r, col: cc, exitRow: exitR, exitCol: exitC, param: sp.param.slice(), nextRelease: 0 });
          }
        }
      }
      checkPipeReleaseForState(state);
      return state;
    }

    function checkPipeReleaseForState(state) {
      for (var pi = 0; pi < state.pipeInfos.length; pi++) {
        var pipe = state.pipeInfos[pi];
        if (pipe.nextRelease >= pipe.param.length) continue;
        var exitKey = pipe.exitRow + ',' + pipe.exitCol;
        if (!state.occupiedCells[exitKey]) {
          var pItem = pipe.param[pipe.nextRelease];
          state.pipeReleasedBalls.push({
            row: pipe.exitRow, col: pipe.exitCol,
            colorId: YarnLevel.getPipeItemId(pItem),
            count: YarnLevel.getPipeItemCount(pItem),
            pipeRow: pipe.row, pipeCol: pipe.col, pipeIndex: pipe.nextRelease
          });
          state.occupiedCells[exitKey] = true;
          pipe.nextRelease++;
        }
      }
    }

    function activateNeighborsForState(state, row, col) {
      var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (var d = 0; d < dirs.length; d++) {
        var nr = row + dirs[d][0], nc = col + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (!ns || isObstacle(ns)) continue;
        var nKey = nr + ',' + nc;
        if (!state.activated[nKey]) {
          state.activated[nKey] = true;
          if (state.frozen[nKey] && !state.frozen[nKey].activated) state.frozen[nKey].activated = true;
        }
      }
    }

    function isBallAvailableInState(state, ball) {
      var cellKey = ball.row + ',' + ball.col;
      if (!state.activated[cellKey]) return false;
      if (state.picked[cellKey]) return false;
      if (ball.frozen) {
        var fs = state.frozen[cellKey];
        if (!fs || !fs.activated || fs.thawProgress < 3) return false;
      }
      if (ball.chain) {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        var partnerOk = false;
        for (var d = 0; d < dirs.length; d++) {
          var nr = ball.row + dirs[d][0], nc = ball.col + dirs[d][1];
          if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
          var ns = spools[nr] && spools[nr][nc];
          if (!ns) continue;
          var ntypes = Array.isArray(ns.type) ? ns.type : [ns.type];
          if (ntypes.indexOf(5) !== -1 && !state.picked[nr + ',' + nc]) {
            if (state.activated[nr + ',' + nc]) partnerOk = true;
            break;
          }
        }
        if (!partnerOk) return false;
      }
      return true;
    }

    function getAvailableBalls(state) {
      var available = [];
      for (var i = 0; i < state.remaining.length; i++) {
        if (isBallAvailableInState(state, state.remaining[i])) {
          available.push({ idx: i, ball: state.remaining[i], fromPipe: false });
        }
      }
      for (var j = 0; j < state.pipeReleasedBalls.length; j++) {
        var prb = state.pipeReleasedBalls[j];
        if (state.activated[prb.row + ',' + prb.col]) {
          available.push({ idx: j, ball: prb, fromPipe: true });
        }
      }
      return available;
    }

    // 记录一次滞留：residence=滞留步数, avgBufDuring=滞留期间暂存均值
    // 加权滞留 = 滞留步数 × 含金量权重(由暂存均值映射)
    function recordResidence(state, residence, avgBufDuring) {
      var w = residenceWeight(avgBufDuring);
      state.residences.push({
        residence: residence,
        weighted: residence * w,
        avgBufDuring: avgBufDuring,
        progressPct: totalTargetSpools > 0 ? state.eliminatedSpools / totalTargetSpools * 100 : 0
      });
    }

    // 滞留含金量权重：按"滞留期间暂存区均值"映射。
    // 暂存低(1-3)时滞留没压力→降权；4开始有压力；5-6高压→高权。
    function residenceWeight(avgBuf) {
      if (avgBuf <= 3) return 0.5;
      if (avgBuf < 5) return 1.0;   // 4
      if (avgBuf < 6) return 1.5;   // 5
      return 2.0;                   // 6+
    }

    // 在 head 指针视图上匹配单个线轴：从左到右扫各列栈顶，匹配则 head++。
    // 直接修改传入的 heads 数组；返回消除数。调用方负责更新 targetRemaining。
    function matchOnHeads(colorId, room, heads) {
      var eliminated = 0;
      if (room <= 0) return 0;
      var changed = true;
      while (changed && eliminated < room) {
        changed = false;
        for (var c = 0; c < NUM_COLS; c++) {
          if (eliminated >= room) break;
          var h = heads[c];
          if (h < COL_LEN[c] && SHARED_COLS[c][h] === colorId) {
            heads[c] = h + 1;
            eliminated++;
            changed = true;
          }
        }
      }
      return eliminated;
    }

    // 预测匹配数（不改 state）：复制 heads（~70整数，廉价）后模拟
    function peekMatchOnHeads(colorId, room, heads) {
      if (room <= 0) return 0;
      return matchOnHeads(colorId, room, heads.slice());
    }

    function autoReleaseBuffer(state) {
      var changed = true;
      while (changed) {
        changed = false;
        for (var bi = state.buffer.length - 1; bi >= 0; bi--) {
          var item = state.buffer[bi];
          var room = item.need - item.progress;
          if (room <= 0) continue;
          var actual = matchOnHeads(item.colorId, room, state.targetHeads);
          if (actual > 0) {
            item.progress += actual;
            state.targetRemaining -= actual;
            if (item.progress >= item.need) {
              state.buffer.splice(bi, 1);
              state.eliminatedSpools++;
              var res = (item.bornStep !== undefined) ? (state.steps - item.bornStep + 1) : 1;
              var avgBufDuring = (item.bufSteps > 0) ? (item.bufSum / item.bufSteps) : state.buffer.length + 1;
              recordResidence(state, res, avgBufDuring);
            }
            changed = true;
          }
        }
      }
    }

    function executePickOnState(state, availItem) {
      var chosenBall = availItem.ball;
      var fromPipe = availItem.fromPipe;

      if (fromPipe) state.pipeReleasedBalls.splice(availItem.idx, 1);
      else state.remaining.splice(availItem.idx, 1);

      state.steps++;
      var pickedKey = chosenBall.row + ',' + chosenBall.col;
      state.picked[pickedKey] = true;
      delete state.occupiedCells[pickedKey];

      for (var fKey in state.frozen) {
        var fs = state.frozen[fKey];
        if (fs.activated && fs.thawProgress < 3) fs.thawProgress++;
      }

      activateNeighborsForState(state, chosenBall.row, chosenBall.col);
      checkPipeReleaseForState(state);

      var chainPartner = null;
      if (chosenBall.chain && !fromPipe) {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length && !chainPartner; d++) {
          var nr = chosenBall.row + dirs[d][0], nc = chosenBall.col + dirs[d][1];
          if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
          for (var ri = 0; ri < state.remaining.length; ri++) {
            var rb = state.remaining[ri];
            if (rb.row === nr && rb.col === nc && rb.chain) { chainPartner = { idx: ri, ball: rb }; break; }
          }
        }
      }

      // 锁链配对球先一起进场（移除/激活/管道），再两球先后完整扫描消除
      if (chainPartner) {
        state.remaining.splice(chainPartner.idx, 1);
        var pKey = chainPartner.ball.row + ',' + chainPartner.ball.col;
        state.picked[pKey] = true;
        delete state.occupiedCells[pKey];
        activateNeighborsForState(state, chainPartner.ball.row, chainPartner.ball.col);
        checkPipeReleaseForState(state);
      }

      // 主球先完整扫描
      if (chosenBall.colorId > 0) {
        var need = chosenBall.count || YarnLevel.DEFAULT_ORDER;
        var ec = matchOnHeads(chosenBall.colorId, need, state.targetHeads);
        state.targetRemaining -= ec;
        if (ec >= need) {
          state.eliminatedSpools++;
          // 进入即完成：滞留1步，滞留期间暂存=当前暂存长度
          recordResidence(state, 1, state.buffer.length);
        } else {
          state.buffer.push({ colorId: chosenBall.colorId, progress: ec, need: need, bornStep: state.steps, bufSum: 0, bufSteps: 0 });
        }
      }

      // 配对球在主球抢完后的棋盘上完整扫描（同色抢色效果）
      if (chainPartner) {
        var pneed = chainPartner.ball.count || YarnLevel.DEFAULT_ORDER;
        var pe = matchOnHeads(chainPartner.ball.colorId, pneed, state.targetHeads);
        state.targetRemaining -= pe;
        if (pe >= pneed) {
          state.eliminatedSpools++;
          recordResidence(state, 1, state.buffer.length);
        } else {
          state.buffer.push({ colorId: chainPartner.ball.colorId, progress: pe, need: pneed, bornStep: state.steps, bufSum: 0, bufSteps: 0 });
        }
        state.pickOrder.push({
          step: state.steps, row: chainPartner.ball.row, col: chainPartner.ball.col,
          colorId: chainPartner.ball.colorId,
          colorName: YarnLevel.getColorName(chainPartner.ball.colorId),
          source: 'cell', dist: chainPartner.ball.dist,
          bufferAfter: state.buffer.length, isFrozen: false, note: '锁链配对'
        });
      }

      // 两球都扫完后，再统一自动释放暂存
      autoReleaseBuffer(state);

      // 本步结束：给仍在暂存里的球采样当前暂存占用（用于算各球滞留期间的暂存均值）
      // 同时累加每球已滞留步数（bufSteps），用于本步"暂存球平均滞留"采样
      var _resSum = 0;
      for (var sbi = 0; sbi < state.buffer.length; sbi++) {
        state.buffer[sbi].bufSum += state.buffer.length;
        state.buffer[sbi].bufSteps += 1;
        _resSum += state.buffer[sbi].bufSteps;   // 该球到此刻为止已滞留步数
      }
      var _resAvg = state.buffer.length > 0 ? (_resSum / state.buffer.length) : 0;

      state.stepBufferHistory.push(state.buffer.length);
      state.stepResidenceHistory.push(parseFloat(_resAvg.toFixed(2)));
      state.stepElimHistory.push(state.eliminatedSpools);
      state.pickOrder.push({
        step: state.steps, row: chosenBall.row, col: chosenBall.col,
        colorId: chosenBall.colorId,
        colorName: chosenBall.colorId > 0 ? YarnLevel.getColorName(chosenBall.colorId) : '问号',
        source: fromPipe ? 'pipe' : 'cell',
        pipeRow: chosenBall.pipeRow, pipeCol: chosenBall.pipeCol, pipeIndex: chosenBall.pipeIndex,
        dist: chosenBall.dist, bufferAfter: state.buffer.length,
        isFrozen: chosenBall.frozen,
        note: chosenBall.frozen ? '解冻后取出' : (chosenBall.chain ? '锁链' : (fromPipe ? '管道释放' : ''))
      });

      // ★ 硬规则：暂存区结算后 ≥ 上限(7) 即死亡（暂存填满=无法消除）
      // 全档通用（含全知版）：即使前瞻漏判（如锁链一次进2球），这里兜底判死 → 交外层重试/回溯
      // 全知版死亡后由 analyzeOptimalSolution 换种子回溯，保证最终找到不触顶的通关路径
      if (state.buffer.length >= BUFFER_LIMIT) {
        state._died = true;
        return false;
      }
      return true;
    }

    function isCompleted(state) {
      return state.targetRemaining === 0 && state.buffer.length === 0;
    }

    function scoreSingleStep(state, availItem) {
      var ball = availItem.ball;
      var colorId = ball.colorId;
      var need = ball.count || YarnLevel.DEFAULT_ORDER;
      var bufBefore = state.buffer.length;

      var th = state.targetHeads.slice();  // 只复制指针数组（廉价）
      var tb = [];
      for (var b = 0; b < state.buffer.length; b++) tb.push({ colorId: state.buffer[b].colorId, progress: state.buffer[b].progress, need: state.buffer[b].need });

      var ec = matchOnHeads(colorId, need, th);
      var fullyElim = ec >= need;
      if (!fullyElim) tb.push({ colorId: colorId, progress: ec, need: need });
      var oldProgress = 0;
      var changed = true;
      while (changed) {
        changed = false;
        for (var bi = tb.length - 1; bi >= 0; bi--) {
          var it = tb[bi];
          var room = it.need - it.progress;
          if (room <= 0) continue;
          var got = matchOnHeads(it.colorId, room, th);
          if (got > 0) {
            it.progress += got;
            oldProgress += got;
            if (it.progress >= it.need) { tb.splice(bi, 1); }
            changed = true;
          }
        }
      }

      var simBuffer = tb.length;
      var bufferDelta = simBuffer - bufBefore;

      var score = 0;
      if (bufferDelta <= -2) score += 30;
      else if (bufferDelta === -1) score += 25;
      else if (bufferDelta === 0) score += 20;
      else if (bufferDelta === 1) {
        if (bufBefore <= 2) score -= 3;
        else if (bufBefore === 3) score -= 8;
        else score -= 20;
      } else if (bufferDelta >= 2) {
        if (bufBefore <= 1) score -= 5;
        else score -= 15;
      }

      score += oldProgress * 0.3;

      if (!fullyElim) {
        for (var k = 0; k < state.buffer.length; k++) {
          if (state.buffer[k].colorId === colorId) score -= 8;
        }
      }

      score -= (ball.dist || 0) * 0.1;

      // 冰块解冻保护：若场上有"已激活但未解冻"的冰块，取任意球都会推进解冻，
      // 但临近收尾时若周围可取球耗尽，冰块会被困住。给"取球能推进未解冻冰块"加分，
      // 避免把冰块周围的球过早取光导致它无法解冻。
      var thawingIce = 0;
      for (var fk in state.frozen) {
        var fz = state.frozen[fk];
        if (fz.activated && fz.thawProgress < 3) thawingIce++;
      }
      if (thawingIce > 0) {
        // 每有一个待解冻冰块，取球（推进解冻）本身就有价值
        score += Math.min(thawingIce, 3) * 1.5;
      }

      // 均匀取管道（仅高手档）：优先取"已释放最少"的管道的球，避免某管道积压深层球。
      if (EVEN_PIPE && availItem.fromPipe) {
        var releases = [];
        for (var ppi = 0; ppi < state.pipeInfos.length; ppi++) {
          if (state.pipeInfos[ppi].param.length > 0) releases.push(state.pipeInfos[ppi].nextRelease);
        }
        if (releases.length > 1) {
          var minR = releases[0], maxR = releases[0], avgR = 0;
          for (var ri2 = 0; ri2 < releases.length; ri2++) {
            if (releases[ri2] < minR) minR = releases[ri2];
            if (releases[ri2] > maxR) maxR = releases[ri2];
            avgR += releases[ri2];
          }
          avgR /= releases.length;
          // 当前球所属管道的已释放数
          var thisRel = null;
          for (var pp2 = 0; pp2 < state.pipeInfos.length; pp2++) {
            if (state.pipeInfos[pp2].row === ball.pipeRow && state.pipeInfos[pp2].col === ball.pipeCol) {
              thisRel = state.pipeInfos[pp2].nextRelease; break;
            }
          }
          if (thisRel !== null) {
            var dev = thisRel - avgR;
            if (dev < -0.5) score += Math.min(12, Math.abs(dev) * 4);      // 落后管道→鼓励取
            else if (dev > 1.0) score -= Math.min(8, dev * 3);              // 领先管道→抑制
            if (maxR - minR >= 3 && thisRel >= maxR) score -= 8;            // 别再刷最深的
          }
        }
      }

      // === 全局规划增强（全知最优版）===
      if (EXPAND) {
        // 策略1：管道口优先——当前能消的目标色，若棋盘上也有同色普通球，优先取管道口的同色球
        //（让管道均匀消耗，避免关键色被埋在管道深处，利于中后期收尾）
        if (ec > 0 && availItem.fromPipe) {
          // 棋盘上是否存在同色的非管道可取球
          var sameColorOnBoard = false;
          for (var ri3 = 0; ri3 < state.remaining.length; ri3++) {
            var rb3 = state.remaining[ri3];
            if (rb3.colorId === colorId) { sameColorOnBoard = true; break; }
          }
          if (sameColorOnBoard) score += 6; // 同色时优先消管道口，把棋盘同色留着保持灵活
        }

        // 策略2：拓展棋盘——取这球会激活几个新邻居（解锁新可用球），越多越好
        if (ball.source === 'cell' || !availItem.fromPipe) {
          var dirs2 = [[-1,0],[1,0],[0,-1],[0,1]];
          var unlocked = 0;
          for (var d2 = 0; d2 < dirs2.length; d2++) {
            var ur = ball.row + dirs2[d2][0], uc = ball.col + dirs2[d2][1];
            if (ur < 0 || ur >= maprow || uc < 0 || uc >= mapcol) continue;
            var uk = ur + ',' + uc;
            if (state.activated[uk] || state.picked[uk]) continue;
            var us = spools[ur] && spools[ur][uc];
            if (us && !isObstacle(us) && us.id > 0) unlocked++;
          }
          score += unlocked * 2.5; // 每解锁一个新邻居加分
        }

        // 策略3：前期(暂存压力小,<=2)可牺牲暂存换拓展——
        // 此时即使这步增加暂存(bufferDelta>0)，只要能解锁新球/丰富颜色，降低惩罚
        if (bufBefore <= 2 && bufferDelta > 0) {
          // 已在策略2加了解锁分；这里再额外补偿前期增存的惩罚，鼓励铺开棋盘
          score += 4;
        }
      }

      // 随机噪声（多轮重试时打破固定选择，跳出死路）
      if (noise > 0) {
        score += (rng() - 0.5) * noise * 20;
      }

      return { score: score, bufferDelta: bufferDelta, simBuffer: simBuffer };
    }

    function findMatch(avail, ball) {
      for (var i = 0; i < avail.length; i++) {
        var b = avail[i].ball;
        if (b.row === ball.row && b.col === ball.col && b.colorId === ball.colorId &&
            (b.pipeIndex === undefined || b.pipeIndex === ball.pipeIndex)) return i;
      }
      return -1;
    }

    function chooseBestStep(state, available, depth) {
      // depth = 前瞻深度（1=单步贪心，2/3=多步树形）
      depth = depth || 1;

      function topCandidates(st, avail, limit) {
        var scored = [];
        for (var i = 0; i < avail.length; i++) {
          scored.push({ i: i, s: scoreSingleStep(st, avail[i]).score });
        }
        scored.sort(function(a, b) { return b.s - a.s; });
        return scored.slice(0, limit);
      }

      // 递归：返回从 st 出发、再走 d 步能达到的最高累计分
      function bestFutureScore(st, d) {
        if (d <= 0) return 0;
        var av = getAvailableBalls(st);
        if (av.length === 0) return 0;
        var tops = topCandidates(st, av, 3);
        var bestSub = -Infinity;
        for (var t = 0; t < tops.length; t++) {
          var sObj = scoreSingleStep(st, av[tops[t].i]);
          var sub;
          if (d === 1) {
            sub = sObj.score;
          } else {
            var st2 = st.clone();
            var av2 = getAvailableBalls(st2);
            var m = findMatch(av2, av[tops[t].i].ball);
            if (m < 0) { sub = sObj.score; }
            else {
              executePickOnState(st2, av2[m]);
              sub = sObj.score + bestFutureScore(st2, d - 1);
            }
          }
          if (sub > bestSub) bestSub = sub;
        }
        return bestSub === -Infinity ? 0 : bestSub;
      }

      var best = null;

      // 单步贪心（depth=1）：不做任何前瞻
      if (depth <= 1) {
        for (var pa = 0; pa < available.length; pa++) {
          var ps = scoreSingleStep(state, available[pa]);
          if (!best || ps.score > best.total ||
              (Math.abs(ps.score - best.total) < 3 && ps.bufferDelta < best.bufferDelta)) {
            best = { availIdx: pa, total: ps.score, bufferDelta: ps.bufferDelta, simBuffer: ps.simBuffer };
          }
        }
        return best;
      }

      // 多步前瞻（depth=2/3）：第1步全枚举，后续递归取 top3
      for (var a = 0; a < available.length; a++) {
        var s1 = scoreSingleStep(state, available[a]);
        var st1 = state.clone();
        var av1 = getAvailableBalls(st1);
        var match1 = findMatch(av1, available[a].ball);
        if (match1 < 0) continue;
        executePickOnState(st1, av1[match1]);

        var total = s1.score + bestFutureScore(st1, depth - 1);

        if (!best || total > best.total ||
            (Math.abs(total - best.total) < 3 && s1.bufferDelta < best.bufferDelta)) {
          best = { availIdx: a, total: total, bufferDelta: s1.bufferDelta, simBuffer: s1.simBuffer };
        }
      }
      return best;
    }

    function isSafeStep(state, availItem) {
      var sim = scoreSingleStep(state, availItem);
      if (sim.simBuffer >= BUFFER_LIMIT) return false;
      // 玩家模式：只防即时溢出，不做依赖"未来揭示"的前瞻安全检查
      if (playerMode) return true;
      if (sim.simBuffer >= BUFFER_LIMIT - 1) {
        var st = state.clone();
        var av = getAvailableBalls(st);
        var m = findMatch(av, availItem.ball);
        if (m < 0) return false;
        executePickOnState(st, av[m]);
        var av2 = getAvailableBalls(st);
        var hasRelief = false;
        for (var i = 0; i < av2.length; i++) {
          if (scoreSingleStep(st, av2[i]).bufferDelta < 0) { hasRelief = true; break; }
        }
        if (!hasRelief) return false;
      }
      return true;
    }

    var state = createInitialState();
    var maxSteps = totalTargetSpools + 50;

    while (!isCompleted(state) && !state._died && state.steps < maxSteps) {
      if (Date.now() - startTime > TIMEOUT_MS) { console.log('[Solver3] 超时'); break; }

      var available = getAvailableBalls(state);
      if (available.length === 0) break;

      // 玩家模式：常态用配置的前瞻深度；暂存压力大(>=4)时提升前瞻"仔细推理"。
      // 任何一步都不能让暂存超过上限(7)；若无任何安全步 → 本次尝试死亡。
      if (playerMode) {
        // 先判断是否存在不溢出的一步（结算后 <7 才算安全，=7即死）
        var anySafe = false;
        for (var sc = 0; sc < available.length; sc++) {
          if (scoreSingleStep(state, available[sc]).simBuffer < BUFFER_LIMIT) { anySafe = true; break; }
        }
        if (!anySafe) { state._died = true; break; }

        // 过滤掉会到达/超过上限的候选，只在安全候选里决策
        var safeAvail = [];
        for (var sa = 0; sa < available.length; sa++) {
          if (scoreSingleStep(state, available[sa]).simBuffer < BUFFER_LIMIT) safeAvail.push(available[sa]);
        }

        // 误触：玩家没拿到当前最优球，而是拿了一个"看起来不错、实际次优"的球。
        // 不是只挑最差无用球——而是从"次优候选"里随机选一个（更真实）。
        // 误触率按进度分段调整（前期更专注、后期色彩杂乱更易误触）：
        //   0-50%：×0.6（降40%）  50-70%：×1.0（正常）  70-100%：×1.1（增10%）
        var _prog = totalTargetSpools > 0 ? (state.eliminatedSpools / totalTargetSpools) : 0;
        var _misMul = _prog < 0.5 ? 0.6 : (_prog < 0.7 ? 1.0 : 1.1);
        var _effMis = MISCLICK_RATE * _misMul;
        if (_effMis > 0 && state.buffer.length <= 3 && rng() < _effMis && safeAvail.length >= 2) {
          // 按单步评分排序
          var scoredMis = [];
          for (var ui = 0; ui < safeAvail.length; ui++) {
            scoredMis.push({ idx: ui, score: scoreSingleStep(state, safeAvail[ui]).score });
          }
          scoredMis.sort(function(a, b) { return b.score - a.score; });
          // 去掉最优(index 0，玩家本该选的完美一步)，从剩下的里选——
          // 偏向中上段：在 [1, ceil(n*0.6)) 范围内随机，模拟"以为不错的次优选择"
          var hi = Math.max(2, Math.ceil(scoredMis.length * 0.6));
          var pickRange = Math.min(hi, scoredMis.length);
          var misPick = 1 + Math.floor(rng() * (pickRange - 1));
          executePickOnState(state, safeAvail[scoredMis[misPick].idx]);
          state._misclicks = (state._misclicks || 0) + 1;
          continue;
        }

        // 当前推理深度：压力大时提升
        var curDepth = (state.buffer.length >= BUFFER_LIMIT - 3) ? PRESSURE_LOOKAHEAD : LOOKAHEAD;

        var pick = chooseBestStep(state, safeAvail, curDepth);
        if (!pick) { state._died = true; break; }
        executePickOnState(state, safeAvail[pick.availIdx]);
        continue;
      }

      if (state.buffer.length >= BUFFER_LIMIT - 2) {
        var bestRelief = null;
        for (var i = 0; i < available.length; i++) {
          var sim = scoreSingleStep(state, available[i]);
          if (sim.simBuffer >= BUFFER_LIMIT) continue; // 结算后达到上限(7)即死，绝不选
          if (!bestRelief || sim.simBuffer < bestRelief.simBuffer ||
              (sim.simBuffer === bestRelief.simBuffer && sim.score > bestRelief.score)) {
            bestRelief = { idx: i, simBuffer: sim.simBuffer, score: sim.score };
          }
        }
        if (bestRelief) { executePickOnState(state, available[bestRelief.idx]); continue; }
        // 所有可取球都会到达上限 → 本轮失败（交给外层回溯换顺序）
        state._died = true; break;
      }

      var best = chooseBestStep(state, available, LOOKAHEAD);
      if (best && isSafeStep(state, available[best.availIdx])) {
        executePickOnState(state, available[best.availIdx]);
        continue;
      }

      var fallback = null;
      for (var fi = 0; fi < available.length; fi++) {
        var fsim = scoreSingleStep(state, available[fi]);
        if (fsim.simBuffer >= BUFFER_LIMIT) continue;
        if (!fallback || fsim.simBuffer < fallback.simBuffer ||
            (fsim.simBuffer === fallback.simBuffer && fsim.score > fallback.score)) {
          fallback = { idx: fi, simBuffer: fsim.simBuffer, score: fsim.score };
        }
      }
      if (fallback) { executePickOnState(state, available[fallback.idx]); continue; }

      // 没有任何合法（不溢出）的一步 → 本轮失败，交给外层回溯
      state._died = true; break;
    }

    var elapsed = Date.now() - startTime;
    var totalSteps = state.steps;
    var maxBuffer = 0, totalBuf = 0;
    for (var hi = 0; hi < state.stepBufferHistory.length; hi++) {
      totalBuf += state.stepBufferHistory[hi];
      if (state.stepBufferHistory[hi] > maxBuffer) maxBuffer = state.stepBufferHistory[hi];
    }
    var avgBuffer = totalSteps > 0 ? (totalBuf / totalSteps) : 0;
    var progress = totalTargetSpools > 0 ? Math.round(state.eliminatedSpools / totalTargetSpools * 100) : 0;

    // === 暂存消耗效率（滞留步数）统计 ===
    // residence: 每个球滞留步数；weighted: 加权滞留(滞留步数×滞留期间暂存含金量权重)
    var resArr = state.residences;
    var avgResidence = 0, maxResidence = 0, avgRawResidence = 0;
    if (resArr.length > 0) {
      var rsum = 0, rawsum = 0;
      for (var rI = 0; rI < resArr.length; rI++) {
        var wv = (resArr[rI].weighted !== undefined) ? resArr[rI].weighted : resArr[rI].residence;
        rsum += wv;
        rawsum += resArr[rI].residence;
        if (wv > maxResidence) maxResidence = wv;
      }
      avgResidence = rsum / resArr.length;       // 加权平均滞留
      avgRawResidence = rawsum / resArr.length;  // 原始平均滞留（参考）
    }
    // 按进度分 10 段，统计各段"加权滞留"均值 → 找难度峰值区间
    var BANDS = 10;
    var bandSum = new Array(BANDS), bandCnt = new Array(BANDS);
    for (var bI = 0; bI < BANDS; bI++) { bandSum[bI] = 0; bandCnt[bI] = 0; }
    for (var rJ = 0; rJ < resArr.length; rJ++) {
      var bandIdx = Math.min(BANDS - 1, Math.floor(resArr[rJ].progressPct / (100 / BANDS)));
      if (bandIdx < 0) bandIdx = 0;
      var wv2 = (resArr[rJ].weighted !== undefined) ? resArr[rJ].weighted : resArr[rJ].residence;
      bandSum[bandIdx] += wv2;
      bandCnt[bandIdx]++;
    }
    var residenceByBand = [];
    var peakBandIdx = -1, peakBandAvg = -1;
    for (var bK = 0; bK < BANDS; bK++) {
      var bAvg = bandCnt[bK] > 0 ? bandSum[bK] / bandCnt[bK] : 0;
      residenceByBand.push({
        band: (bK * 10) + '-' + ((bK + 1) * 10) + '%',
        avgResidence: parseFloat(bAvg.toFixed(2)),
        count: bandCnt[bK]
      });
      if (bandCnt[bK] > 0 && bAvg > peakBandAvg) { peakBandAvg = bAvg; peakBandIdx = bK; }
    }
    var peakBand = peakBandIdx >= 0 ? residenceByBand[peakBandIdx].band : '-';

    console.log('[Solver3] 完成 steps=' + totalSteps + ' 通关=' + isCompleted(state) + ' 耗时=' + elapsed + 'ms');

    return {
      totalSteps: totalSteps,
      totalTargetSpools: totalTargetSpools,
      eliminatedSpools: state.eliminatedSpools,
      progress: Math.min(progress, 100),
      maxBuffer: maxBuffer,
      avgBuffer: parseFloat(avgBuffer.toFixed(2)),
      avgBufferRatio: parseFloat((totalSteps > 0 ? (totalBuf / totalSteps / BUFFER_LIMIT * 100) : 0).toFixed(1)),
      bufferLimit: BUFFER_LIMIT,
      bufferFinal: state.buffer.length,
      stepBufferHistory: state.stepBufferHistory,
      stepElimHistory: state.stepElimHistory,
      stepResidenceHistory: state.stepResidenceHistory,
      pickOrder: state.pickOrder,
      completed: isCompleted(state),
      died: !!state._died,
      // 暂存消耗效率因子
      avgResidence: parseFloat(avgResidence.toFixed(2)),
      avgRawResidence: parseFloat(avgRawResidence.toFixed(2)),
      maxResidence: parseFloat(maxResidence.toFixed(2)),
      residenceByBand: residenceByBand,
      peakResidenceBand: peakBand,
      peakResidenceAvg: parseFloat((peakBandAvg < 0 ? 0 : peakBandAvg).toFixed(2)),
      validationErrors: [],
      solverVersion: playerMode ? 'Player' : '3Step',
      playerMode: playerMode,
      misclicks: state._misclicks || 0,
      solverTime: elapsed
    };
  }

  /**
   * 分析可达性：从第一行出发，考虑激活传播规则
   * 返回 { hasBlockage, blockedCount, totalBalls, unlockPlan }
   * unlockPlan: 按顺序需要拾取的格子列表（用于打通关键通道）
   */
  function analyzeReachability(spools, maprow, mapcol) {
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    
    function isObs(s) { return !s || s.id === -1 || s.id === 0; }
    function isFrozen(s) {
      if (!s) return false;
      var types = Array.isArray(s.type) ? s.type : [s.type];
      return types.indexOf(4) !== -1;
    }
    function isPipe(s) {
      if (!s) return false;
      var t = Array.isArray(s.type) ? s.type[0] : s.type;
      return t >= 11 && t <= 14;
    }

    // 第一轮BFS：假设所有非黑块格子都可连通（不考虑激活顺序）
    // 这代表"理论上最终能到达的所有格子"
    var allReachable = {};
    var q = [];
    for (var c = 0; c < mapcol; c++) {
      var s = spools[0] && spools[0][c];
      if (s && !isObs(s)) {
        allReachable['0,' + c] = true;
        q.push([0, c]);
      }
    }
    while (q.length > 0) {
      var cur = q.shift();
      for (var d = 0; d < dirs.length; d++) {
        var nr = cur[0] + dirs[d][0], nc = cur[1] + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        var nKey = nr + ',' + nc;
        if (allReachable[nKey]) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (isObs(ns) || isPipe(ns)) continue;
        allReachable[nKey] = true;
        q.push([nr, nc]);
      }
    }

    // 第二轮BFS：只走"第一行直接激活传播能到达的"（不穿越冰块）
    // 冰块本身可到达（会被激活），但冰块后面的格子需要先解冻才能继续传播
    var freeReachable = {};
    var freeQ = [];
    for (var c = 0; c < mapcol; c++) {
      var s = spools[0] && spools[0][c];
      if (s && !isObs(s)) {
        freeReachable['0,' + c] = true;
        // 冰块格子可以被激活（到达），但它阻止继续传播
        if (!isFrozen(s)) {
          freeQ.push([0, c]);
        }
      }
    }
    while (freeQ.length > 0) {
      var cur = freeQ.shift();
      for (var d = 0; d < dirs.length; d++) {
        var nr = cur[0] + dirs[d][0], nc = cur[1] + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        var nKey = nr + ',' + nc;
        if (freeReachable[nKey]) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (isObs(ns) || isPipe(ns)) continue;
        freeReachable[nKey] = true;
        if (!isFrozen(ns)) {
          freeQ.push([nr, nc]);
        }
        // 冰块格子：标记为可到达但不继续扩展（它是传播阻断点）
      }
    }

    // 被阻断的区域：在allReachable中但不在freeReachable中
    var blockedCells = [];
    var totalBalls = 0;
    for (var key in allReachable) {
      var parts = key.split(',');
      var r = parseInt(parts[0]), c = parseInt(parts[1]);
      var s = spools[r] && spools[r][c];
      if (s && s.id > 0 && !isPipe(s)) totalBalls++;
      if (!freeReachable[key]) {
        blockedCells.push(key);
      }
    }

    var hasBlockage = blockedCells.length > 3; // 超过3个格子被封锁才算有可达性问题

    // 找关键冰块：位于freeReachable边界、拾取后能打通到blockedCells区域的冰块
    var criticalIce = []; // [{row, col, behindCount}]
    for (var key in freeReachable) {
      var parts = key.split(',');
      var r = parseInt(parts[0]), c = parseInt(parts[1]);
      var s = spools[r] && spools[r][c];
      if (!s || !isFrozen(s)) continue;

      // 这个冰块拾取后能解锁多少格子？
      var behindCount = 0;
      var behindVisited = {};
      behindVisited[key] = true;
      var bQ = [[r, c]];
      while (bQ.length > 0) {
        var bc = bQ.shift();
        for (var d = 0; d < dirs.length; d++) {
          var bnr = bc[0] + dirs[d][0], bnc = bc[1] + dirs[d][1];
          var bKey = bnr + ',' + bnc;
          if (behindVisited[bKey]) continue;
          if (bnr < 0 || bnr >= maprow || bnc < 0 || bnc >= mapcol) continue;
          var bns = spools[bnr] && spools[bnr][bnc];
          if (isObs(bns) || isPipe(bns)) continue;
          behindVisited[bKey] = true;
          if (!freeReachable[bKey]) {
            behindCount++;
          }
          if (!isFrozen(bns)) {
            bQ.push([bnr, bnc]);
          }
        }
      }

      if (behindCount > 0) {
        criticalIce.push({ row: r, col: c, behindCount: behindCount });
      }
    }

    // 按behindCount降序排列（最关键的冰块优先）
    criticalIce.sort(function(a, b) { return b.behindCount - a.behindCount; });

    return {
      hasBlockage: hasBlockage,
      blockedCount: blockedCells.length,
      totalBalls: totalBalls,
      criticalIce: criticalIce,
      freeReachable: freeReachable
    };
  }

  /**
   * 通道检测（重写版）：
   * 
   * 核心定义：通道 = 一条必经之路上连续出现2+个冰块/锁链，且路线宽度=1（无法绕过）
   * 
   * 检测方法：
   * 1. 从freeReachable边缘的冰块出发
   * 2. 沿着"窄道"方向前进（检查是否有绕路选择）
   * 3. 统计窄道上连续的障碍数量
   * 4. 连续障碍>=2 → 通道问题
   */
  function analyzeCriticalCorridors(spools, maprow, mapcol, reachInfo) {
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    var freeReachable = reachInfo.freeReachable || {};
    
    function isObs(s) { return !s || s.id === -1 || s.id === 0; }
    function isPipe(s) { if (!s) return false; var t = Array.isArray(s.type) ? s.type[0] : s.type; return t >= 11 && t <= 14; }
    function isFrozen(s) { if (!s) return false; var types = Array.isArray(s.type) ? s.type : [s.type]; return types.indexOf(4) !== -1; }
    function isChain(s) { if (!s) return false; var types = Array.isArray(s.type) ? s.type : [s.type]; return types.indexOf(5) !== -1; }
    function isBlocked(r, c) {
      if (r < 0 || r >= maprow || c < 0 || c >= mapcol) return true;
      var s = spools[r] && spools[r][c];
      return !s || s.id === -1 || isPipe(s);
    }
    
    // 统计总球数
    var totalBalls = 0;
    var blockedBalls = 0;
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (!s || isObs(s) || isPipe(s)) continue;
        if (s.id > 0) { totalBalls++; if (!freeReachable[r+','+c]) blockedBalls++; }
      }
    }
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (s && isPipe(s) && Array.isArray(s.param)) totalBalls += s.param.length;
      }
    }
    if (totalBalls === 0) return { hasCriticalCorridor: false, severity: 'low', corridors: [], blockedRatio: 0, requiredThawSteps: 0 };
    var blockedRatio = blockedBalls / totalBalls;
    
    // === 找窄道上的连续障碍 ===
    // 从freeReachable中的冰块出发，沿着被封锁方向探索
    var corridors = [];
    var processed = {};
    
    for (var key in freeReachable) {
      var parts = key.split(',');
      var r = parseInt(parts[0]), c = parseInt(parts[1]);
      var s = spools[r] && spools[r][c];
      if (!s || !isFrozen(s)) continue; // 只从冰块开始
      if (processed[key]) continue;
      
      // 这个冰块是否在窄道上？
      // 检查：它的左右（或上下）是否被堵死
      // 如果水平方向被堵（左右都是障碍/边界）→ 垂直窄道
      // 如果垂直方向被堵（上下都是障碍/边界）→ 水平窄道
      var leftBlocked = isBlocked(r, c-1);
      var rightBlocked = isBlocked(r, c+1);
      var upBlocked = isBlocked(r-1, c);
      var downBlocked = isBlocked(r+1, c);
      
      var narrowDirs = []; // 窄道延伸方向
      if (leftBlocked && rightBlocked) {
        // 垂直窄道：只能往上或下走
        if (!upBlocked) narrowDirs.push([-1, 0]);
        if (!downBlocked) narrowDirs.push([1, 0]);
      }
      if (upBlocked && downBlocked) {
        // 水平窄道：只能往左或右走
        if (!leftBlocked) narrowDirs.push([0, -1]);
        if (!rightBlocked) narrowDirs.push([0, 1]);
      }
      // 也检查对角线情况：某个方向被堵+管道
      // 简化：如果4个方向中只有1-2个可通行且另外方向被堵 → 算窄道
      var openDirs = 0;
      var openDirList = [];
      for (var d = 0; d < dirs.length; d++) {
        if (!isBlocked(r + dirs[d][0], c + dirs[d][1])) {
          openDirs++;
          openDirList.push(dirs[d]);
        }
      }
      if (openDirs <= 2 && narrowDirs.length === 0) {
        // 只有1-2个方向可走 → 窄道
        for (var d = 0; d < openDirList.length; d++) {
          var nr = r + openDirList[d][0], nc = c + openDirList[d][1];
          if (!freeReachable[nr+','+nc]) { // 向被封锁方向
            narrowDirs.push(openDirList[d]);
          }
        }
      }
      
      if (narrowDirs.length === 0) continue;
      
      // 沿窄道方向探索：统计连续的障碍（冰块/锁链）和路径长度
      for (var nd = 0; nd < narrowDirs.length; nd++) {
        var dir = narrowDirs[nd];
        var corridor = { cells: [{row: r, col: c}], obstacles: [{row: r, col: c, type: 'ice', unlockCost: 4}], behindCount: 0, totalCost: 4, totalUnlockSteps: 4, entryCell: {row: r, col: c}, normalCells: [] };
        processed[key] = true;
        
        var curR = r + dir[0], curC = c + dir[1];
        var depth = 0;
        var maxDepth = 15; // 最多探索15步
        
        while (depth < maxDepth) {
          if (curR < 0 || curR >= maprow || curC < 0 || curC >= mapcol) break;
          var curKey = curR + ',' + curC;
          var curS = spools[curR] && spools[curR][curC];
          if (!curS || isObs(curS) || isPipe(curS)) break;
          
          processed[curKey] = true;
          corridor.cells.push({row: curR, col: curC, depth: depth});
          corridor.behindCount++;
          
          if (isFrozen(curS)) {
            corridor.obstacles.push({row: curR, col: curC, type: 'ice', unlockCost: 4});
            corridor.totalCost += 4;
          } else if (isChain(curS)) {
            corridor.obstacles.push({row: curR, col: curC, type: 'chain', unlockCost: 2});
            corridor.totalCost += 2;
          } else {
            corridor.normalCells.push({row: curR, col: curC, cost: 1});
            corridor.totalCost += 1;
          }
          
          // 检查当前格子是否仍在窄道中（左右/上下被堵）
          // 如果到了一个开阔区域（3+方向可通行）→ 窄道结束
          var curOpen = 0;
          for (var d = 0; d < dirs.length; d++) {
            var checkR = curR + dirs[d][0], checkC = curC + dirs[d][1];
            if (!isBlocked(checkR, checkC)) curOpen++;
          }
          if (curOpen >= 3) {
            // 到达开阔区域，计算这个区域后面还有多少球
            var behindVisited = {};
            behindVisited[curKey] = true;
            var behindQ = [[curR, curC]];
            while (behindQ.length > 0) {
              var bc = behindQ.shift();
              for (var d = 0; d < dirs.length; d++) {
                var bnr = bc[0]+dirs[d][0], bnc = bc[1]+dirs[d][1];
                var bk = bnr+','+bnc;
                if (behindVisited[bk] || freeReachable[bk]) continue;
                if (bnr<0||bnr>=maprow||bnc<0||bnc>=mapcol) continue;
                var bns = spools[bnr]&&spools[bnr][bnc];
                if (!bns||isObs(bns)||isPipe(bns)) continue;
                behindVisited[bk] = true;
                if (bns.id > 0) corridor.behindCount++;
                behindQ.push([bnr, bnc]);
              }
            }
            break;
          }
          
          // 继续沿同方向前进
          curR += dir[0];
          curC += dir[1];
          depth++;
        }
        
        corridor.totalUnlockSteps = corridor.totalCost;
        
        // 只有连续障碍>=2才算通道问题
        if (corridor.obstacles.length >= 2) {
          corridors.push(corridor);
        }
      }
    }
    
    corridors.sort(function(a, b) { return b.behindCount - a.behindCount; });
    
    var requiredThawSteps = 0;
    var totalBehind = 0;
    for (var i = 0; i < corridors.length; i++) {
      requiredThawSteps += corridors[i].totalUnlockSteps;
      totalBehind += corridors[i].behindCount;
    }
    
    var severity = 'low';
    if (corridors.length > 0 && corridors[0].obstacles.length >= 3) {
      severity = 'extreme';
    } else if (corridors.length > 0 && corridors[0].obstacles.length >= 2 && totalBehind >= 8) {
      severity = 'high';
    } else if (corridors.length > 0) {
      severity = 'moderate';
    }
    
    return { hasCriticalCorridor: corridors.length > 0, severity: severity, corridors: corridors, blockedRatio: blockedRatio, requiredThawSteps: requiredThawSteps };
  }

  // ==================== 新版求解器V2：Beam Search + DFS回溯 + 多路径探索 ====================

  /**
   * runSolverV2 — 完整改造版求解器
   * 
   * 架构：
   *   1. Beam Search（主力）：同时探索多条路径，宽度=30-60
   *   2. 回溯机制：暂存区满时自动回退到上一个分叉点，换一条路
   *   3. 随机噪声重启：如果 Beam 失败，用不同随机种子重试
   *   4. DFS 兜底：极端情况下深度优先搜索
   * 
   * 核心改进：
   *   - 不再是"一路向前不回头"的贪心
   *   - 状态完整可克隆，支持任意节点回退
   *   - 多条路径并行推进，避免局部最优陷阱
   */
  function runSolverV2(spools, maprow, mapcol, blocks, BUFFER_LIMIT, seedOffset) {
    var startTime = Date.now();
    var TIMEOUT_MS = 30000; // 30秒超时（从15秒提升，确保更多关卡通关）
    seedOffset = seedOffset || 0;
    
    // === 通道分析（沿用） ===
    var reachInfo = analyzeReachability(spools, maprow, mapcol);
    var corridorPlan = analyzeCriticalCorridors(spools, maprow, mapcol, reachInfo);
    
    console.log('[SolverV2] 开始求解, corridorPlan:', corridorPlan.severity);
    
    // === 构建目标区模型 ===
    function buildTargetColumns(blks) {
      var cols = [];
      var total = 0;
      if (blks && blks.length > 0) {
        var bCols = blks[0].length;
        for (var c = 0; c < bCols; c++) {
          var col = [];
          for (var r = blks.length - 1; r >= 0; r--) {
            var _bid = YarnLevel.getBlockId(blks[r] && blks[r][c]);
            if (_bid > 0) {
              col.push(_bid);
              total++;
            }
          }
          cols.push(col);
        }
      }
      return { columns: cols, totalPixels: total };
    }
    
    var targetInfo = buildTargetColumns(blocks);
    var totalTargetPixels = targetInfo.totalPixels;
    var totalTargetSpools = Math.floor(totalTargetPixels / 3);
    
    // === BFS距离预计算 ===
    var dist = bfsFromTopRow(spools, maprow, mapcol);
    
    // === 通道障碍集合 ===
    var corridorObstacleSet = {};
    var corridorCellSet = {};
    if (corridorPlan.hasCriticalCorridor) {
      for (var ci = 0; ci < corridorPlan.corridors.length; ci++) {
        var corridor = corridorPlan.corridors[ci];
        for (var oi = 0; oi < corridor.cells.length; oi++) {
          var cCell = corridor.cells[oi];
          corridorCellSet[cCell.row + ',' + cCell.col] = { behindCount: corridor.behindCount };
        }
        for (var oi = 0; oi < corridor.obstacles.length; oi++) {
          var obs = corridor.obstacles[oi];
          corridorObstacleSet[obs.row + ',' + obs.col] = { priority: corridor.behindCount, type: obs.type };
        }
      }
    }
    
    // =========================================================================
    // SolverState: 完整可克隆的游戏状态
    // =========================================================================
    function SolverState() {
      this.activated = {};
      this.picked = {};
      this.frozen = {};        // 'r,c' -> {activated, thawProgress}
      this.occupiedCells = {};
      this.buffer = [];        // [{colorId, progress}]
      this.targetColumns = []; // [[colorId, ...], ...]
      this.pipeInfos = [];     // [{row, col, exitRow, exitCol, param, nextRelease}]
      this.pipeReleasedBalls = []; // [{row, col, colorId, pipeRow, pipeCol, pipeIndex}]
      this.remaining = [];     // [{row, col, colorId, source, frozen, chain, question}]
      this.steps = 0;
      this.eliminatedSpools = 0;
      this.pickOrder = [];
      this.stepBufferHistory = [];
      this.globalPickCount = 0;
    }
    
    SolverState.prototype.clone = function() {
      var s = new SolverState();
      // 轻量级克隆：避免 JSON.parse/stringify 的巨大开销
      var k;
      s.activated = {};
      for (k in this.activated) s.activated[k] = true;
      s.picked = {};
      for (k in this.picked) s.picked[k] = true;
      s.frozen = {};
      for (k in this.frozen) s.frozen[k] = { activated: this.frozen[k].activated, thawProgress: this.frozen[k].thawProgress };
      s.occupiedCells = {};
      for (k in this.occupiedCells) s.occupiedCells[k] = true;
      s.buffer = [];
      for (var i = 0; i < this.buffer.length; i++) {
        s.buffer.push({ colorId: this.buffer[i].colorId, progress: this.buffer[i].progress });
      }
      s.targetColumns = [];
      for (var i = 0; i < this.targetColumns.length; i++) {
        s.targetColumns.push(this.targetColumns[i].slice());
      }
      s.pipeInfos = [];
      for (var i = 0; i < this.pipeInfos.length; i++) {
        var p = this.pipeInfos[i];
        s.pipeInfos.push({ row: p.row, col: p.col, exitRow: p.exitRow, exitCol: p.exitCol, param: p.param, nextRelease: p.nextRelease });
      }
      s.pipeReleasedBalls = [];
      for (var i = 0; i < this.pipeReleasedBalls.length; i++) {
        var prb = this.pipeReleasedBalls[i];
        s.pipeReleasedBalls.push({ row: prb.row, col: prb.col, colorId: prb.colorId, pipeRow: prb.pipeRow, pipeCol: prb.pipeCol, pipeIndex: prb.pipeIndex, source: prb.source, frozen: prb.frozen, chain: prb.chain, question: prb.question, dist: prb.dist });
      }
      s.remaining = [];
      for (var i = 0; i < this.remaining.length; i++) {
        var r = this.remaining[i];
        s.remaining.push({ row: r.row, col: r.col, colorId: r.colorId, dist: r.dist, source: r.source, frozen: r.frozen, chain: r.chain, question: r.question });
      }
      s.steps = this.steps;
      s.eliminatedSpools = this.eliminatedSpools;
      // pickOrder 和 stepBufferHistory 只在最终输出时需要，搜索中用浅拷贝
      s.pickOrder = this.pickOrder.slice();
      s.stepBufferHistory = this.stepBufferHistory.slice();
      s.globalPickCount = this.globalPickCount;
      return s;
    };
    
    // === 初始化状态 ===
    function createInitialState() {
      var state = new SolverState();
      
      // 目标区
      var ti = buildTargetColumns(blocks);
      state.targetColumns = ti.columns;
      
      // 激活第一行
      for (var c = 0; c < mapcol; c++) {
        var s = spools[0] && spools[0][c];
        if (s && !isObstacle(s)) {
          state.activated['0,' + c] = true;
        }
      }
      
      // 占据格、冰块、管道、球列表
      for (var r = 0; r < maprow; r++) {
        for (var c = 0; c < mapcol; c++) {
          var s = spools[r] && spools[r][c];
          if (!s) continue;
          var key = r + ',' + c;
          
          if (s.id > 0 && !isObstacle(s)) {
            state.occupiedCells[key] = true;
            var types = Array.isArray(s.type) ? s.type : (s.type === 0 ? [] : [s.type]);
            var isFrozen = types.indexOf(4) !== -1;
            var isChain = types.indexOf(5) !== -1;
            var isQuestion = types.indexOf(6) !== -1;
            
            state.remaining.push({
              row: r, col: c,
              colorId: s.id,
              dist: dist[r][c],
              source: 'cell',
              frozen: isFrozen,
              chain: isChain,
              question: isQuestion
            });
            
            if (isFrozen) {
              state.frozen[key] = {
                activated: !!state.activated[key],
                thawProgress: (r === 0 ? -1 : 0)   // 第一行冰块全局也需4步解冻
              };
            }
          }
          
          // 管道
          if (YarnLevel.isPipeType(s.type) && Array.isArray(s.param) && s.param.length > 0) {
            var dir = YarnLevel.getPipeDirection(s.type);
            var exitR = r, exitC = c;
            if (dir === 11) exitR = r - 1;
            else if (dir === 12) exitC = c + 1;
            else if (dir === 13) exitR = r + 1;
            else if (dir === 14) exitC = c - 1;
            state.pipeInfos.push({
              row: r, col: c,
              exitRow: exitR, exitCol: exitC,
              param: s.param.slice(),
              nextRelease: 0
            });
          }
        }
      }
      
      // 初始管道释放
      checkPipeReleaseForState(state);
      
      return state;
    }
    
    // === 状态操作函数 ===
    
    function checkPipeReleaseForState(state) {
      for (var pi = 0; pi < state.pipeInfos.length; pi++) {
        var pipe = state.pipeInfos[pi];
        if (pipe.nextRelease >= pipe.param.length) continue;
        var exitKey = pipe.exitRow + ',' + pipe.exitCol;
        if (!state.occupiedCells[exitKey]) {
          var colorId = pipe.param[pipe.nextRelease];
          state.pipeReleasedBalls.push({
            row: pipe.exitRow, col: pipe.exitCol,
            colorId: colorId,
            pipeRow: pipe.row, pipeCol: pipe.col,
            pipeIndex: pipe.nextRelease,
            source: 'pipe', frozen: false, chain: false, question: false, dist: 0
          });
          state.occupiedCells[exitKey] = true;
          pipe.nextRelease++;
        }
      }
    }
    
    function activateNeighborsForState(state, row, col) {
      var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (var d = 0; d < dirs.length; d++) {
        var nr = row + dirs[d][0], nc = col + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (!ns || isObstacle(ns)) continue;
        var nKey = nr + ',' + nc;
        if (!state.activated[nKey]) {
          state.activated[nKey] = true;
          if (state.frozen[nKey] && !state.frozen[nKey].activated) {
            state.frozen[nKey].activated = true;
          }
        }
      }
    }
    
    function isBallAvailableInState(state, ball) {
      if (ball.source === 'pipe') return false; // 管道球通过pipeReleasedBalls管理
      var cellKey = ball.row + ',' + ball.col;
      if (!state.activated[cellKey]) return false;
      if (state.picked[cellKey]) return false;
      if (ball.frozen) {
        var fs = state.frozen[cellKey];
        if (!fs || !fs.activated || fs.thawProgress < 3) return false;
      }
      if (ball.chain) {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        var partnerOk = false;
        for (var d = 0; d < dirs.length; d++) {
          var nr = ball.row + dirs[d][0], nc = ball.col + dirs[d][1];
          if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
          var ns = spools[nr] && spools[nr][nc];
          if (!ns) continue;
          var ntypes = Array.isArray(ns.type) ? ns.type : [ns.type];
          if (ntypes.indexOf(5) !== -1 && !state.picked[nr + ',' + nc]) {
            if (state.activated[nr + ',' + nc]) partnerOk = true;
            break;
          }
        }
        if (!partnerOk) return false;
      }
      return true;
    }
    
    function getAvailableBalls(state) {
      var available = [];
      for (var i = 0; i < state.remaining.length; i++) {
        if (isBallAvailableInState(state, state.remaining[i])) {
          available.push({ idx: i, ball: state.remaining[i], fromPipe: false });
        }
      }
      for (var i = 0; i < state.pipeReleasedBalls.length; i++) {
        var prb = state.pipeReleasedBalls[i];
        if (state.activated[prb.row + ',' + prb.col]) {
          available.push({ idx: i, ball: prb, fromPipe: true });
        }
      }
      return available;
    }
    
    // 线轴匹配（修改 targetColumns 原地）
    function matchSpoolInTarget(colorId, progress, tCols) {
      var eliminated = 0;
      var needed = 3 - progress;
      if (needed <= 0) return 0;
      var changed = true;
      while (changed && eliminated < needed) {
        changed = false;
        for (var c = 0; c < tCols.length; c++) {
          if (eliminated >= needed) break;
          if (tCols[c].length > 0 && tCols[c][0] === colorId) {
            tCols[c].shift();
            eliminated++;
            changed = true;
          }
        }
      }
      return eliminated;
    }
    
    // 预测匹配数（不修改状态）
    function peekMatchInTarget(colorId, progress, tCols) {
      var temp = [];
      for (var c = 0; c < tCols.length; c++) temp.push(tCols[c].slice());
      return matchSpoolInTarget(colorId, progress, temp);
    }
    
    // 自动释放暂存区
    function autoReleaseBuffer(state) {
      var released = 0;
      var changed = true;
      while (changed) {
        changed = false;
        for (var bi = state.buffer.length - 1; bi >= 0; bi--) {
          var item = state.buffer[bi];
          if (peekMatchInTarget(item.colorId, item.progress, state.targetColumns) > 0) {
            var actual = matchSpoolInTarget(item.colorId, item.progress, state.targetColumns);
            item.progress += actual;
            if (item.progress >= 3) {
              state.buffer.splice(bi, 1);
              state.eliminatedSpools++;
              released++;
            }
            changed = true;
          }
        }
      }
      return released;
    }
    
    // 执行一步拾取，返回是否成功
    function executePickOnState(state, availItem) {
      var chosenBall = availItem.ball;
      var fromPipe = availItem.fromPipe;
      
      // 从列表移除
      if (fromPipe) {
        state.pipeReleasedBalls.splice(availItem.idx, 1);
      } else {
        state.remaining.splice(availItem.idx, 1);
      }
      
      state.steps++;
      state.globalPickCount++;
      var pickedKey = chosenBall.row + ',' + chosenBall.col;
      state.picked[pickedKey] = true;
      delete state.occupiedCells[pickedKey];
      
      // 推进冰块解冻
      for (var fKey in state.frozen) {
        var fs = state.frozen[fKey];
        if (fs.activated && fs.thawProgress < 3) fs.thawProgress++;
      }
      
      // 激活相邻
      activateNeighborsForState(state, chosenBall.row, chosenBall.col);
      
      // 管道释放
      checkPipeReleaseForState(state);
      
      // 锁链配对处理
      var chainPartner = null;
      if (chosenBall.chain && chosenBall.source === 'cell') {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nr = chosenBall.row + dirs[d][0], nc = chosenBall.col + dirs[d][1];
          if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
          for (var ri = 0; ri < state.remaining.length; ri++) {
            var rb = state.remaining[ri];
            if (rb.row === nr && rb.col === nc && rb.chain && rb.source === 'cell') {
              chainPartner = { idx: ri, ball: rb };
              break;
            }
          }
          if (chainPartner) break;
        }
      }
      
      // 主球匹配
      var colorId = chosenBall.colorId;
      if (colorId > 0) {
        var ec = matchSpoolInTarget(colorId, 0, state.targetColumns);
        if (ec >= 3) {
          state.eliminatedSpools++;
        } else {
          state.buffer.push({ colorId: colorId, progress: ec });
        }
      }
      autoReleaseBuffer(state);
      
      // 锁链配对执行
      if (chainPartner) {
        state.remaining.splice(chainPartner.idx, 1);
        var pKey = chainPartner.ball.row + ',' + chainPartner.ball.col;
        state.picked[pKey] = true;
        delete state.occupiedCells[pKey];
        activateNeighborsForState(state, chainPartner.ball.row, chainPartner.ball.col);
        checkPipeReleaseForState(state);
        
        var pc = chainPartner.ball.colorId;
        if (pc > 0) {
          var pe = matchSpoolInTarget(pc, 0, state.targetColumns);
          if (pe >= 3) {
            state.eliminatedSpools++;
          } else {
            state.buffer.push({ colorId: pc, progress: pe });
          }
        }
        autoReleaseBuffer(state);
        
        state.pickOrder.push({
          step: state.steps, row: chainPartner.ball.row, col: chainPartner.ball.col,
          colorId: pc, colorName: pc > 0 ? YarnLevel.getColorName(pc) : '问号',
          source: 'cell', dist: chainPartner.ball.dist,
          bufferAfter: state.buffer.length, isFrozen: false, note: '锁链配对'
        });
      }
      
      autoReleaseBuffer(state);
      state.stepBufferHistory.push(state.buffer.length);
      
      state.pickOrder.push({
        step: state.steps, row: chosenBall.row, col: chosenBall.col,
        colorId: chosenBall.colorId,
        colorName: chosenBall.colorId > 0 ? YarnLevel.getColorName(chosenBall.colorId) : '问号',
        source: chosenBall.source,
        pipeRow: chosenBall.pipeRow, pipeCol: chosenBall.pipeCol,
        pipeIndex: chosenBall.pipeIndex,
        dist: chosenBall.dist, bufferAfter: state.buffer.length,
        isFrozen: chosenBall.frozen,
        note: chosenBall.frozen ? '解冻后取出' : (chosenBall.chain ? '锁链' : (fromPipe ? '管道释放' : ''))
      });
      
      return true;
    }
    
    // 检查是否通关
    function isCompleted(state) {
      var remaining = 0;
      for (var c = 0; c < state.targetColumns.length; c++) remaining += state.targetColumns[c].length;
      return remaining === 0 && state.buffer.length === 0;
    }
    
    // 检查是否失败（暂存区溢出且无法释放）
    function isFailed(state) {
      return state.buffer.length >= BUFFER_LIMIT;
    }
    
    // === 评分函数：评估一个状态的质量 ===
    function evaluateState(state, noise, rng) {
      // 核心指标：进度（已消除/总数）越高越好，暂存越低越好
      var progress = totalTargetSpools > 0 ? state.eliminatedSpools / totalTargetSpools : 0;
      var bufferPenalty = state.buffer.length / BUFFER_LIMIT;
      
      // 可用球的质量：有多少球能直接消除
      var available = getAvailableBalls(state);
      var canElimCount = 0;
      var totalRemaining = state.remaining.length + state.pipeReleasedBalls.length;
      for (var i = 0; i < available.length; i++) {
        if (peekMatchInTarget(available[i].ball.colorId, 0, state.targetColumns) >= 3) {
          canElimCount++;
        }
      }
      var availQuality = available.length > 0 ? canElimCount / available.length : 0;
      
      // 可达性健康度：可用球 / 总剩余球（越低说明越多球被锁住）
      var reachRatio = totalRemaining > 0 ? available.length / totalRemaining : 1;
      // 如果大量球不可达，这是危险信号
      var reachPenalty = 0;
      if (reachRatio < 0.3 && totalRemaining > 5) {
        reachPenalty = (0.3 - reachRatio) * 40; // 严重惩罚：太多球被锁
      }
      
      // 通道加分：已激活的通道格子越多越好
      var corridorBonus = 0;
      if (corridorPlan.hasCriticalCorridor) {
        var activatedCorr = 0, totalCorr = 0;
        for (var ck in corridorCellSet) {
          totalCorr++;
          if (state.activated[ck]) activatedCorr++;
        }
        corridorBonus = totalCorr > 0 ? activatedCorr / totalCorr * 0.2 : 0;
      }
      
      // 暂存区颜色多样性惩罚：如果暂存中都是不同颜色且目标区都不可消，极其危险
      var bufferDangerPenalty = 0;
      if (state.buffer.length >= 4) {
        var unmatchable = 0;
        for (var i = 0; i < state.buffer.length; i++) {
          if (peekMatchInTarget(state.buffer[i].colorId, state.buffer[i].progress, state.targetColumns) === 0) {
            unmatchable++;
          }
        }
        if (unmatchable >= 3) {
          bufferDangerPenalty = unmatchable * 5;
        }
      }
      
      var score = progress * 100
                - bufferPenalty * 30
                + availQuality * 10
                + corridorBonus * 15
                - reachPenalty
                - bufferDangerPenalty
                - state.steps * 0.01; // 微小惩罚步数，让最短路径略优
      
      // === 管道均衡度评估 ===
      // 如果各管道消耗进度差异太大，整体状态质量下降
      if (state.pipeInfos.length > 1) {
        var pipeReleases = [];
        for (var pi = 0; pi < state.pipeInfos.length; pi++) {
          if (state.pipeInfos[pi].param.length > 0) {
            pipeReleases.push(state.pipeInfos[pi].nextRelease);
          }
        }
        if (pipeReleases.length > 1) {
          var pipeMin = pipeReleases[0], pipeMax = pipeReleases[0];
          for (var pi = 1; pi < pipeReleases.length; pi++) {
            if (pipeReleases[pi] < pipeMin) pipeMin = pipeReleases[pi];
            if (pipeReleases[pi] > pipeMax) pipeMax = pipeReleases[pi];
          }
          var pipeImbalance = pipeMax - pipeMin;
          // 差距>=3开始惩罚，差距越大惩罚越重
          if (pipeImbalance >= 3) {
            score -= (pipeImbalance - 2) * 4;
          }
        }
      }
      
      // 随机噪声
      if (noise && noise > 0 && rng) {
        score += (rng() - 0.5) * noise * 20;
      }
      
      return score;
    }
    
    // === 评估单步候选的质量（快速评分，用于排序） ===
    function evalCandidate(state, availItem, noise, rng) {
      var ball = availItem.ball;
      var colorId = ball.colorId;
      
      // 预测消除能力
      var canElim = peekMatchInTarget(colorId, 0, state.targetColumns);
      
      var score = 0;
      
      // 能消3个 = 最好（不占暂存）
      if (canElim >= 3) {
        score += 30;
      } else if (canElim >= 1) {
        score += 10; // 部分消除
      } else {
        score -= 5; // 完全不能消
        // 暂存压力
        score -= state.buffer.length * 3;
      }
      
      // 同色积压惩罚
      if (canElim < 3) {
        for (var i = 0; i < state.buffer.length; i++) {
          if (state.buffer[i].colorId === colorId) score -= 8;
        }
      }
      
      // 通道加分
      if (ball.source === 'cell') {
        var bKey = ball.row + ',' + ball.col;
        if (corridorCellSet[bKey] || corridorObstacleSet[bKey]) {
          score += 15;
        }
        // 是否会激活通道格子
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nk = (ball.row+dirs[d][0]) + ',' + (ball.col+dirs[d][1]);
          if (!state.activated[nk] && (corridorCellSet[nk] || corridorObstacleSet[nk])) {
            score += 10;
          }
        }
      }
      
      // 距离微惩罚（优先近处球）
      score -= (ball.dist || 0) * 0.1;
      
      // === 管道均衡消耗策略 ===
      // 核心问题：多个管道如果不均匀消耗，后期某个管道积压大量深层球无法推进
      // 策略：优先从"消耗最少"的管道取球，确保各管道进度均匀
      if (ball.source === 'pipe' || availItem.fromPipe) {
        // 计算各管道的消耗进度
        var pipeProgressList = []; // [{pipeKey, released, total, remaining}]
        var totalPipes = state.pipeInfos.length;
        var minReleased = 999, maxReleased = 0;
        var avgReleased = 0;
        
        for (var pi = 0; pi < state.pipeInfos.length; pi++) {
          var pipe = state.pipeInfos[pi];
          var total = pipe.param.length;
          if (total === 0) continue;
          var released = pipe.nextRelease;
          pipeProgressList.push({
            pipeKey: pipe.row + ',' + pipe.col,
            released: released,
            total: total,
            remaining: total - released
          });
          if (released < minReleased) minReleased = released;
          if (released > maxReleased) maxReleased = released;
          avgReleased += released;
        }
        
        if (pipeProgressList.length > 1) {
          avgReleased /= pipeProgressList.length;
          
          // 找到当前球来自哪个管道
          var thisPipeKey = (ball.pipeRow !== undefined ? ball.pipeRow : ball.row) + ',' + (ball.pipeCol !== undefined ? ball.pipeCol : ball.col);
          var thisPipeProgress = null;
          for (var pp = 0; pp < pipeProgressList.length; pp++) {
            if (pipeProgressList[pp].pipeKey === thisPipeKey) {
              thisPipeProgress = pipeProgressList[pp];
              break;
            }
          }
          
          if (thisPipeProgress) {
            // 该管道已消耗数 vs 平均值
            var deviation = thisPipeProgress.released - avgReleased;
            
            // 如果这个管道消耗比平均少（落后管道）→ 取它的球是好事，加分
            if (deviation < -0.5) {
              score += Math.min(15, Math.abs(deviation) * 5);
            }
            // 如果这个管道消耗比平均多（领先管道）→ 取它的球不紧急，微惩罚
            else if (deviation > 1.0) {
              score -= Math.min(8, deviation * 3);
            }
            
            // 极端不均衡惩罚：某管道0消耗 + 另一管道已消耗4+ → 严重偏差
            if (maxReleased - minReleased >= 4 && thisPipeProgress.released >= maxReleased) {
              score -= 10; // 别继续刷已经很深的管道
            }
            if (maxReleased - minReleased >= 4 && thisPipeProgress.released <= minReleased) {
              score += 12; // 优先推进最落后的管道
            }
          }
        }
      }
      
      // === 管道出口球的"解锁效果"===
      // 取走管道出口球后，管道会释放下一个球。如果下一个球的颜色是目标区急需的，加分
      if (availItem.fromPipe || ball.source === 'pipe') {
        var pRow = ball.pipeRow !== undefined ? ball.pipeRow : ball.row;
        var pCol = ball.pipeCol !== undefined ? ball.pipeCol : ball.col;
        for (var pi = 0; pi < state.pipeInfos.length; pi++) {
          var pipe = state.pipeInfos[pi];
          if (pipe.row === pRow && pipe.col === pCol) {
            // 检查管道的下一个球（当前球取走后会释放的）
            var nextIdx = pipe.nextRelease; // 当前待释放的就是这个球
            if (nextIdx + 1 < pipe.param.length) {
              var nextColor = pipe.param[nextIdx + 1];
              var nextCanElim = peekMatchInTarget(nextColor, 0, state.targetColumns);
              if (nextCanElim >= 3) {
                score += 8; // 取当前球后下一个能消，形成连锁
              }
              // 暂存区正等这个颜色
              for (var bi = 0; bi < state.buffer.length; bi++) {
                if (state.buffer[bi].colorId === nextColor) {
                  score += 5;
                  break;
                }
              }
            }
            break;
          }
        }
      }
      
      // === 棋盘球对管道出口的激活效果 ===
      // 取走棋盘球可能空出管道出口格，触发管道释放
      if (ball.source === 'cell') {
        var bKey2 = ball.row + ',' + ball.col;
        for (var pi = 0; pi < state.pipeInfos.length; pi++) {
          var pipe = state.pipeInfos[pi];
          if (pipe.nextRelease >= pipe.param.length) continue;
          var exitKey = pipe.exitRow + ',' + pipe.exitCol;
          if (exitKey === bKey2) {
            // 取走这个球后管道会释放新球
            var relColor = pipe.param[pipe.nextRelease];
            var relCanElim = peekMatchInTarget(relColor, 0, state.targetColumns);
            if (relCanElim >= 3) {
              score += 10; // 释放的球能消，非常好
            } else if (relCanElim >= 1) {
              score += 4;
            }
            // 管道均衡加分：如果这个管道是最落后的
            var thisReleased = pipe.nextRelease;
            var otherMax = 0;
            for (var pj = 0; pj < state.pipeInfos.length; pj++) {
              if (pj === pi) continue;
              if (state.pipeInfos[pj].nextRelease > otherMax) otherMax = state.pipeInfos[pj].nextRelease;
            }
            if (otherMax - thisReleased >= 2) {
              score += 6; // 激活落后管道
            }
            break;
          }
        }
      }
      
      // === 运行时窄路感知 ===
      // 核心问题：中后期贴墙区域（管道+黑块+墙）形成宽度=1的通道
      // 必须按顺序清理入口处的球，才能激活深处的球
      if (ball.source === 'cell') {
        var bRow = ball.row, bCol = ball.col;
        
        // 检测：拾取这个球后会激活的邻居中，是否有"被封锁的未激活球"
        // 如果有，说明这个球是窄路入口，清掉它能打通后续路径
        var dirs4 = [[-1,0],[1,0],[0,-1],[0,1]];
        var unlocksCount = 0;
        var unlocksNeededColor = false;
        
        for (var d = 0; d < dirs4.length; d++) {
          var nr = bRow + dirs4[d][0], nc = bCol + dirs4[d][1];
          if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
          var nKey = nr + ',' + nc;
          if (state.activated[nKey]) continue; // 已激活的不算
          var ns = spools[nr] && spools[nr][nc];
          if (!ns || isObstacle(ns) || ns.id <= 0) continue;
          
          // 这个邻居当前未激活，拾取当前球后会被激活
          unlocksCount++;
          
          // 检查被解锁的邻居颜色是否是暂存区正在等待的
          for (var bi = 0; bi < state.buffer.length; bi++) {
            if (state.buffer[bi].colorId === ns.id) {
              unlocksNeededColor = true;
              break;
            }
          }
          
          // 检查被解锁的邻居颜色是否是目标区当前能消的
          if (peekMatchInTarget(ns.id, 0, state.targetColumns) >= 3) {
            unlocksNeededColor = true;
          }
          
          // 深层检测：该邻居后面是否还有更多被封锁的球（窄路深度）
          // 简化版：看该邻居的邻居中有多少也未激活的
          var deepCount = 0;
          for (var d2 = 0; d2 < dirs4.length; d2++) {
            var nr2 = nr + dirs4[d2][0], nc2 = nc + dirs4[d2][1];
            if (nr2 < 0 || nr2 >= maprow || nc2 < 0 || nc2 >= mapcol) continue;
            var nKey2 = nr2 + ',' + nc2;
            if (state.activated[nKey2]) continue;
            if (nKey2 === bRow + ',' + bCol) continue; // 排除当前球自己
            var ns2 = spools[nr2] && spools[nr2][nc2];
            if (ns2 && !isObstacle(ns2) && ns2.id > 0) deepCount++;
          }
          if (deepCount > 0) unlocksCount += deepCount;
        }
        
        // 加分：解锁越多球越好（窄路入口优先）
        if (unlocksCount > 0) {
          score += unlocksCount * 3;
          // 如果解锁的球是暂存区/目标区急需的颜色，额外加分
          if (unlocksNeededColor) {
            score += 12;
          }
        }
        
        // === 窄路深处球的紧急度提升 ===
        // 如果当前球在棋盘下半部分（row > maprow/2）且只有1个方向相邻已激活球
        // 说明它处于窄路内部，应该尽快被取走让路
        if (bRow > maprow / 2) {
          var activatedNeighborCount = 0;
          for (var d = 0; d < dirs4.length; d++) {
            var anr = bRow + dirs4[d][0], anc = bCol + dirs4[d][1];
            if (anr < 0 || anr >= maprow || anc < 0 || anc >= mapcol) continue;
            var ank = anr + ',' + anc;
            // 已激活且已拾取 = 开放方向
            if (state.picked[ank] || (state.activated[ank] && !state.occupiedCells[ank])) {
              activatedNeighborCount++;
            }
          }
          // 只有1个方向开放（窄路内部）→ 提升优先级
          if (activatedNeighborCount <= 1) {
            score += 8;
            // 并且如果它能消，进一步加分（窄路中能消的球最优先）
            if (canElim >= 3) score += 10;
          }
        }
      }
      
      // 随机噪声
      if (noise && noise > 0 && rng) {
        score += (rng() - 0.5) * noise * 15;
      }
      
      return score;
    }
    
    // === 简单伪随机数生成器 ===
    function makeRng(seed) {
      var s = seed || 42;
      return function() {
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (s >>> 0) / 4294967296;
      };
    }
    
    // =========================================================================
    // Beam Search：同时探索多条路径
    // =========================================================================
    function beamSearch(beamWidth, noise, seed, maxSteps) {
      var rng = makeRng(seed);
      maxSteps = maxSteps || 800;
      
      var initState = createInitialState();
      var beams = [{ state: initState, score: evaluateState(initState, 0, null) }];
      
      for (var step = 0; step < maxSteps; step++) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          console.log('[SolverV2] Beam Search 超时, step=' + step);
          break;
        }
        
        var nextBeams = [];
        
        for (var bi = 0; bi < beams.length; bi++) {
          var beam = beams[bi];
          
          // 检查通关
          if (isCompleted(beam.state)) {
            console.log('[SolverV2] Beam Search 通关! steps=' + beam.state.steps + ' beamWidth=' + beamWidth + ' noise=' + noise);
            return beam.state;
          }
          
          // 获取可用球
          var available = getAvailableBalls(beam.state);
          if (available.length === 0) continue; // 死路，剪枝
          
          // 对候选评分并排序
          var scored = [];
          for (var ai = 0; ai < available.length; ai++) {
            var cs = evalCandidate(beam.state, available[ai], noise, rng);
            scored.push({ availIdx: ai, score: cs });
          }
          scored.sort(function(a, b) { return b.score - a.score; });
          
          // 展开 top-K 个候选（限制分支宽度，防止内存爆炸）
          var expandCount = Math.min(scored.length, Math.min(4, Math.max(2, Math.ceil(beamWidth / Math.max(1, beams.length)))));
          // 暂存压力大时只展开能消的候选
          if (beam.state.buffer.length >= 4) {
            expandCount = Math.min(expandCount, 3);
          }
          
          for (var ei = 0; ei < expandCount; ei++) {
            var chosen = available[scored[ei].availIdx];
            var newState = beam.state.clone();
            
            // 重新在新状态中找到对应的球
            var newAvailable = getAvailableBalls(newState);
            var matchedItem = null;
            for (var ni = 0; ni < newAvailable.length; ni++) {
              var nb = newAvailable[ni].ball;
              if (nb.row === chosen.ball.row && nb.col === chosen.ball.col &&
                  nb.colorId === chosen.ball.colorId && nb.source === chosen.ball.source &&
                  (nb.pipeIndex === undefined || nb.pipeIndex === chosen.ball.pipeIndex)) {
                matchedItem = newAvailable[ni];
                break;
              }
            }
            
            if (!matchedItem) continue;
            
            executePickOnState(newState, matchedItem);
            
            // 失败剪枝
            if (isFailed(newState)) continue;
            
            var newScore = evaluateState(newState, noise * 0.3, rng);
            nextBeams.push({ state: newState, score: newScore });
          }
        }
        
        if (nextBeams.length === 0) {
          // 所有路径都死了
          console.log('[SolverV2] Beam Search 所有路径失败, step=' + step);
          break;
        }
        
        // 保留 top beamWidth 条路径
        nextBeams.sort(function(a, b) { return b.score - a.score; });
        beams = nextBeams.slice(0, beamWidth);
        
        // 检查最优路径是否通关
        if (isCompleted(beams[0].state)) {
          console.log('[SolverV2] Beam Search 通关! steps=' + beams[0].state.steps);
          return beams[0].state;
        }
      }
      
      // 返回最优的那条（可能未通关）
      if (beams.length > 0) {
        beams.sort(function(a, b) { return b.score - a.score; });
        return beams[0].state;
      }
      return null;
    }
    
    // =========================================================================
    // DFS with Backtracking：迭代式深度优先搜索（避免栈溢出）
    // =========================================================================
    function dfsWithBacktracking(maxNodes, noise, seed) {
      var rng = makeRng(seed);
      var nodesExplored = 0;
      var bestState = null;
      var bestProgress = 0;
      
      var initState = createInitialState();
      
      // 迭代式DFS栈: [{state, childIdx, children}]
      // children = 已排好序的候选列表
      var stack = [];
      
      // 初始节点
      var initAvailable = getAvailableBalls(initState);
      if (initAvailable.length === 0) return initState;
      
      var initScored = [];
      for (var ai = 0; ai < initAvailable.length; ai++) {
        initScored.push({ availIdx: ai, score: evalCandidate(initState, initAvailable[ai], noise, rng) });
      }
      initScored.sort(function(a, b) { return b.score - a.score; });
      var initChildren = initScored.slice(0, 5); // 根节点展开5个
      
      stack.push({ state: initState, childIdx: 0, children: initChildren, available: initAvailable });
      
      while (stack.length > 0) {
        nodesExplored++;
        if (nodesExplored >= maxNodes) break;
        if (Date.now() - startTime > TIMEOUT_MS) break;
        
        var top = stack[stack.length - 1];
        
        // 当前节点的所有子节点都已尝试完
        if (top.childIdx >= top.children.length) {
          stack.pop();
          continue;
        }
        
        // 尝试下一个子节点
        var childInfo = top.children[top.childIdx];
        top.childIdx++;
        
        var chosen = top.available[childInfo.availIdx];
        var newState = top.state.clone();
        
        // 在新状态中找对应球
        var newAvailable = getAvailableBalls(newState);
        var matchedItem = null;
        for (var ni = 0; ni < newAvailable.length; ni++) {
          var nb = newAvailable[ni].ball;
          if (nb.row === chosen.ball.row && nb.col === chosen.ball.col &&
              nb.colorId === chosen.ball.colorId && nb.source === chosen.ball.source &&
              (nb.pipeIndex === undefined || nb.pipeIndex === chosen.ball.pipeIndex)) {
            matchedItem = newAvailable[ni];
            break;
          }
        }
        if (!matchedItem) continue;
        
        executePickOnState(newState, matchedItem);
        
        // 失败剪枝
        if (isFailed(newState)) continue;
        
        // 通关检查
        if (isCompleted(newState)) {
          bestState = newState;
          console.log('[SolverV2] DFS 通关! nodes=' + nodesExplored + ' depth=' + stack.length);
          break;
        }
        
        // 记录最优进度
        var prog = totalTargetSpools > 0 ? newState.eliminatedSpools / totalTargetSpools : 0;
        if (prog > bestProgress || (prog === bestProgress && (!bestState || newState.buffer.length < bestState.buffer.length))) {
          bestProgress = prog;
          bestState = newState.clone();
        }
        
        // 展开子节点（限制深度和分支）
        var nextAvailable = getAvailableBalls(newState);
        if (nextAvailable.length > 0 && stack.length < 80) {
          var nextScored = [];
          for (var ai = 0; ai < nextAvailable.length; ai++) {
            nextScored.push({ availIdx: ai, score: evalCandidate(newState, nextAvailable[ai], noise, rng) });
          }
          nextScored.sort(function(a, b) { return b.score - a.score; });
          // 越深分支越少
          var branchLimit = stack.length < 10 ? 4 : (stack.length < 20 ? 3 : 2);
          var nextChildren = nextScored.slice(0, branchLimit);
          
          stack.push({ state: newState, childIdx: 0, children: nextChildren, available: nextAvailable });
        }
      }
      
      console.log('[SolverV2] DFS 探索节点=' + nodesExplored + ' 最优进度=' + Math.round(bestProgress * 100) + '%');
      return bestState;
    }
    
    // =========================================================================
    // 贪心回溯：原有贪心 + 卡住时回退重试
    // =========================================================================
    function greedyWithBacktrack(noise, seed, maxRetries) {
      var rng = makeRng(seed);
      maxRetries = maxRetries || 5;
      
      var initState = createInitialState();
      var bestState = null;
      var bestProgress = 0;
      
      for (var retry = 0; retry < maxRetries; retry++) {
        if (Date.now() - startTime > TIMEOUT_MS) break;
        
        var state = retry === 0 ? initState.clone() : initState.clone();
        var checkpoints = []; // 存档点：[{state, step, excludeSet}]
        var currentExcludeSet = {}; // 当前排除集（回溯后排除上次选择）
        var stuckCount = 0;
        
        for (var iter = 0; iter < 800; iter++) {
          if (Date.now() - startTime > TIMEOUT_MS) break;
          
          if (isCompleted(state)) {
            console.log('[SolverV2] 贪心回溯 通关! retry=' + retry + ' steps=' + state.steps);
            return state;
          }
          
          var available = getAvailableBalls(state);
          if (available.length === 0) {
            // 卡住：没有可用球但还有剩余球 = 窄路堵死
            // 需要更激进的回溯（跳回更早的分叉点）
            if (checkpoints.length > 0) {
              // 根据剩余球数量决定回溯深度
              var remainingCount = state.remaining.length + state.pipeReleasedBalls.length;
              var backDepth = remainingCount > 10 ? Math.min(checkpoints.length, 5) : Math.min(checkpoints.length, 3);
              for (var bd = 0; bd < backDepth - 1 && checkpoints.length > 1; bd++) {
                checkpoints.pop();
              }
              var cp = checkpoints.pop();
              state = cp.state;
              currentExcludeSet = cp.excludeSet;
              stuckCount++;
              if (stuckCount > 30) break; // 回溯太多次，放弃这轮重试
              continue;
            }
            break;
          }
          
          // 评分排序
          var scored = [];
          for (var ai = 0; ai < available.length; ai++) {
            var ball = available[ai].ball;
            var bKey = ball.row + ',' + ball.col + ',' + (ball.pipeIndex || 0);
            if (currentExcludeSet[bKey]) continue; // 被排除的选择
            var cs = evalCandidate(state, available[ai], noise * (retry + 1) * 0.3, rng);
            scored.push({ availIdx: ai, score: cs, key: bKey });
          }
          
          if (scored.length === 0) {
            // 所有候选都被排除了，回溯更深
            if (checkpoints.length > 0) {
              var cp = checkpoints.pop();
              state = cp.state;
              currentExcludeSet = cp.excludeSet;
              stuckCount++;
              if (stuckCount > 20) break;
              continue;
            }
            break;
          }
          
          scored.sort(function(a, b) { return b.score - a.score; });
          
          // 选最优
          var chosen = available[scored[0].availIdx];
          
          // 存档策略：更频繁地存档以支持窄路回溯
          // 条件：每2步存一次、暂存>=3时每步存、可用球很少时每步存
          var shouldSave = (state.steps % 2 === 0) || 
                           (state.buffer.length >= 3) || 
                           (available.length <= 3);
          if (shouldSave) {
            var excludeForCP = {};
            excludeForCP[scored[0].key] = true; // 回溯时排除当前选择
            checkpoints.push({
              state: state.clone(),
              excludeSet: excludeForCP
            });
            // 限制存档点数量
            if (checkpoints.length > 25) checkpoints.shift();
          }
          
          currentExcludeSet = {}; // 正常步不排除
          
          executePickOnState(state, chosen);
          
          // 暂存满了→立即回溯
          if (isFailed(state)) {
            if (checkpoints.length > 0) {
              // 回退多步（跳过最近的1-2个存档点，尝试更早的分叉）
              var backSteps = Math.min(checkpoints.length, 2 + Math.floor(retry / 2));
              for (var bs = 0; bs < backSteps - 1 && checkpoints.length > 1; bs++) {
                checkpoints.pop();
              }
              var cp = checkpoints.pop();
              state = cp.state;
              currentExcludeSet = cp.excludeSet;
              stuckCount++;
              if (stuckCount > 30) break;
              continue;
            }
            break;
          }
        }
        
        // 记录最优
        var prog = totalTargetSpools > 0 ? state.eliminatedSpools / totalTargetSpools : 0;
        if (prog > bestProgress || (prog === bestProgress && state.buffer.length === 0 && isCompleted(state))) {
          bestProgress = prog;
          bestState = state;
        }
        
        if (isCompleted(state)) return state;
      }
      
      return bestState;
    }
    
    // =========================================================================
    // 主流程：多策略级联
    // =========================================================================
    
    var bestResult = null;
    var bestProgress = 0;
    
    // 策略1：Beam Search（主力，多种配置尝试）
    var beamConfigs = [
      { width: 20, noise: 0.0, seed: 42 + seedOffset },
      { width: 15, noise: 0.3, seed: 7 + seedOffset },
      { width: 12, noise: 0.6, seed: 99 + seedOffset },
      { width: 18, noise: 0.2, seed: 137 + seedOffset },
      { width: 14, noise: 0.5, seed: 251 + seedOffset },
      { width: 10, noise: 0.9, seed: 503 + seedOffset },
    ];
    
    for (var bci = 0; bci < beamConfigs.length; bci++) {
      if (Date.now() - startTime > TIMEOUT_MS) break;
      var bc = beamConfigs[bci];
      console.log('[SolverV2] 尝试 Beam Search width=' + bc.width + ' noise=' + bc.noise + ' seed=' + bc.seed);
      
      var result = beamSearch(bc.width, bc.noise, bc.seed, 600);
      if (result && isCompleted(result)) {
        bestResult = result;
        console.log('[SolverV2] Beam Search 成功! 配置#' + bci);
        break;
      }
      if (result) {
        var prog = totalTargetSpools > 0 ? result.eliminatedSpools / totalTargetSpools : 0;
        if (prog > bestProgress) {
          bestProgress = prog;
          bestResult = result;
        }
      }
    }
    
    // 策略2：如果 Beam 未通关，尝试贪心回溯（多种噪声+种子组合）
    if (!bestResult || !isCompleted(bestResult)) {
      var greedyConfigs = [
        { noise: 0.0, seed: 1 + seedOffset, retries: 6 },
        { noise: 0.3, seed: 13 + seedOffset, retries: 5 },
        { noise: 0.6, seed: 37 + seedOffset, retries: 4 },
        { noise: 1.0, seed: 73 + seedOffset, retries: 4 },
        { noise: 0.2, seed: 101 + seedOffset, retries: 4 },
        { noise: 0.5, seed: 199 + seedOffset, retries: 3 },
        { noise: 0.8, seed: 307 + seedOffset, retries: 3 },
        { noise: 1.5, seed: 419 + seedOffset, retries: 3 },
      ];
      
      for (var gci = 0; gci < greedyConfigs.length; gci++) {
        if (Date.now() - startTime > TIMEOUT_MS) break;
        var gc = greedyConfigs[gci];
        console.log('[SolverV2] 尝试贪心回溯 noise=' + gc.noise + ' seed=' + gc.seed);
        
        var result = greedyWithBacktrack(gc.noise, gc.seed, gc.retries);
        if (result && isCompleted(result)) {
          bestResult = result;
          console.log('[SolverV2] 贪心回溯 成功! 配置#' + gci);
          break;
        }
        if (result) {
          var prog = totalTargetSpools > 0 ? result.eliminatedSpools / totalTargetSpools : 0;
          if (prog > bestProgress) {
            bestProgress = prog;
            bestResult = result;
          }
        }
      }
    }
    
    // 策略3：最后兜底 DFS（多轮不同种子）
    if (!bestResult || !isCompleted(bestResult)) {
      if (Date.now() - startTime < TIMEOUT_MS) {
        var dfsConfigs = [
          { maxNodes: 80000, noise: 0.2, seed: 11 + seedOffset },
          { maxNodes: 60000, noise: 0.4, seed: 23 + seedOffset },
          { maxNodes: 50000, noise: 0.7, seed: 59 + seedOffset },
          { maxNodes: 50000, noise: 1.0, seed: 97 + seedOffset },
          { maxNodes: 40000, noise: 0.3, seed: 151 + seedOffset },
          { maxNodes: 40000, noise: 1.2, seed: 211 + seedOffset },
        ];
        
        for (var dci = 0; dci < dfsConfigs.length; dci++) {
          if (Date.now() - startTime > TIMEOUT_MS) break;
          var dc = dfsConfigs[dci];
          console.log('[SolverV2] 尝试 DFS maxNodes=' + dc.maxNodes + ' noise=' + dc.noise);
          
          var result = dfsWithBacktracking(dc.maxNodes, dc.noise, dc.seed);
          if (result && isCompleted(result)) {
            bestResult = result;
            console.log('[SolverV2] DFS 成功! 配置#' + dci);
            break;
          }
          if (result) {
            var prog = totalTargetSpools > 0 ? result.eliminatedSpools / totalTargetSpools : 0;
            if (prog > bestProgress) {
              bestProgress = prog;
              bestResult = result;
            }
          }
        }
      }
    }
    
    // === 构建输出结果 ===
    var elapsed = Date.now() - startTime;
    console.log('[SolverV2] 求解完毕, 耗时=' + elapsed + 'ms, 通关=' + (bestResult ? isCompleted(bestResult) : false));
    
    if (!bestResult) {
      // 完全没有结果，退回旧solver
      console.log('[SolverV2] 所有策略失败，回退到旧solver');
      var criticalCells = {};
      return runSolver(spools, maprow, mapcol, blocks, BUFFER_LIMIT, criticalCells);
    }
    
    // 格式化输出（兼容原有接口）
    var totalSteps = bestResult.steps;
    var eliminatedSpools = bestResult.eliminatedSpools;
    var progress = totalTargetSpools > 0 ? Math.round(eliminatedSpools / totalTargetSpools * 100) : 0;
    
    var totalBufferUsage = 0;
    for (var i = 0; i < bestResult.stepBufferHistory.length; i++) {
      totalBufferUsage += bestResult.stepBufferHistory[i];
    }
    var avgBuffer = totalSteps > 0 ? (totalBufferUsage / totalSteps) : 0;
    var avgBufferRatio = totalSteps > 0 ? (totalBufferUsage / totalSteps / BUFFER_LIMIT) : 0;
    var maxBuffer = 0;
    for (var i = 0; i < bestResult.stepBufferHistory.length; i++) {
      if (bestResult.stepBufferHistory[i] > maxBuffer) maxBuffer = bestResult.stepBufferHistory[i];
    }
    
    return {
      totalSteps: totalSteps,
      totalTargetSpools: totalTargetSpools,
      eliminatedSpools: eliminatedSpools,
      progress: Math.min(progress, 100),
      maxBuffer: maxBuffer,
      avgBuffer: parseFloat(avgBuffer.toFixed(2)),
      avgBufferRatio: parseFloat((avgBufferRatio * 100).toFixed(1)),
      bufferLimit: BUFFER_LIMIT,
      bufferFinal: bestResult.buffer.length,
      stepBufferHistory: bestResult.stepBufferHistory,
      pickOrder: bestResult.pickOrder,
      completed: isCompleted(bestResult),
      validationErrors: [],
      corridorAnalysis: corridorPlan,
      solverVersion: 'V2',
      solverTime: elapsed
    };
  }

  // ==================== 旧版求解器（保留作为降级方案） ====================

  function runSolver(spools, maprow, mapcol, blocks, BUFFER_LIMIT, criticalCells) {
    
    // ===================================================================
    // 增强版可达性分析：深度瓶颈通道检测
    // 核心问题：当大量棋盘格子被黑块隔离，只能通过1-2条窄通道访问时，
    // 必须优先打通这些通道（即使暂存区临时积压）
    // ===================================================================
    
    var reachInfo = analyzeReachability(spools, maprow, mapcol);
    var reachabilityMode = reachInfo.hasBlockage;
    
    // 关键冰块集合（需要优先解冻的）
    var criticalIceSet = {};
    for (var ci = 0; ci < reachInfo.criticalIce.length; ci++) {
      var ice = reachInfo.criticalIce[ci];
      criticalIceSet[ice.row + ',' + ice.col] = ice.behindCount;
    }

    // === 深度瓶颈通道分析 ===
    // 目标：找出"必须打通的关键通道"及通道上的障碍序列
    // 通道定义：从当前可达区域到大片未解锁区域的唯一/少数几条路径
    
    var corridorPlan = analyzeCriticalCorridors(spools, maprow, mapcol, reachInfo);
    // corridorPlan: {
    //   hasCriticalCorridor: bool,
    //   severity: 'extreme'|'high'|'moderate'|'low',
    //   corridors: [{
    //     cells: [{row, col}], // 通道上的格子（按顺序）
    //     obstacles: [{row, col, type:'ice'|'chain', unlockCost}],
    //     behindCount: number, // 通道后面的格子数量
    //     totalUnlockSteps: number // 打通整条通道需要的总拾取次数
    //   }],
    //   blockedRatio: number, // 被阻断格子占总球数的比例
    //   requiredThawSteps: number // 解冻所有关键冰块需要的总步数（含激活步+3步解冻）
    // }
    
    // 调试：输出通道分析结果
    console.log('[Solver] corridorPlan:', corridorPlan.severity, 'corridors:', corridorPlan.corridors.length, 'blockedRatio:', corridorPlan.blockedRatio, 'highPriority:', corridorPlan.hasCriticalCorridor && (corridorPlan.severity === 'extreme' || corridorPlan.severity === 'high'));
    
    // 极端模式判定：超过40%的球被封锁 且 有明确的瓶颈通道
    var extremeMode = corridorPlan.hasCriticalCorridor && corridorPlan.severity === 'extreme';
    var highPriorityMode = corridorPlan.hasCriticalCorridor && 
      (corridorPlan.severity === 'extreme' || corridorPlan.severity === 'high');
    
    // 通道上障碍格子集合（高优先级解锁目标）
    var corridorObstacleSet = {}; // 'r,c' -> {priority, behindCount, unlockCost}
    var corridorCellSet = {}; // 通道上所有格子（包括普通球）
    if (corridorPlan.hasCriticalCorridor) {
      for (var ci = 0; ci < corridorPlan.corridors.length; ci++) {
        var corridor = corridorPlan.corridors[ci];
        // 通道入口也标记（在freeReachable中但是通道起点）
        if (corridor.entryCell) {
          var ecKey = corridor.entryCell.row + ',' + corridor.entryCell.col;
          corridorCellSet[ecKey] = {
            corridorIdx: ci,
            orderInCorridor: -1, // 入口
            behindCount: corridor.behindCount,
            isEntry: true
          };
        }
        // 通道上的所有格子
        for (var oi = 0; oi < corridor.cells.length; oi++) {
          var cCell = corridor.cells[oi];
          var ccKey = cCell.row + ',' + cCell.col;
          corridorCellSet[ccKey] = {
            corridorIdx: ci,
            orderInCorridor: oi,
            behindCount: corridor.behindCount,
            depth: cCell.depth || 0,
            cost: cCell.cost || 1
          };
        }
        // 障碍格子（冰块/锁链）额外标记
        for (var oi = 0; oi < corridor.obstacles.length; oi++) {
          var obs = corridor.obstacles[oi];
          corridorObstacleSet[obs.row + ',' + obs.col] = {
            priority: corridor.behindCount * 10 + (corridor.obstacles.length - oi),
            behindCount: corridor.behindCount,
            unlockCost: obs.unlockCost,
            type: obs.type
          };
        }
        // 普通球也标记（它们也是通道成本的一部分）
        for (var ni = 0; ni < corridor.normalCells.length; ni++) {
          var nCell = corridor.normalCells[ni];
          var ncKey = nCell.row + ',' + nCell.col;
          if (!corridorObstacleSet[ncKey]) {
            // 普通通道球也作为"弱障碍"标记（需要拾取才能推进通道）
            corridorObstacleSet[ncKey] = {
              priority: corridor.behindCount * 5,
              behindCount: corridor.behindCount,
              unlockCost: 1,
              type: 'normal'
            };
          }
        }
      }
    }

    // === 构建输出端模型（深拷贝用于模拟） ===
    function buildTargetColumns(blocks) {
      var targetColumns = [];
      var totalPixels = 0;
      if (blocks && blocks.length > 0) {
        var bCols = blocks[0].length;
        for (var c = 0; c < bCols; c++) {
          var col = [];
          for (var r = blocks.length - 1; r >= 0; r--) {
            var _bid = YarnLevel.getBlockId(blocks[r] && blocks[r][c]);
            if (_bid > 0) {
              col.push(_bid);
              totalPixels++;
            }
          }
          targetColumns.push(col);
        }
      }
      return { columns: targetColumns, totalPixels: totalPixels };
    }

    var targetInfo = buildTargetColumns(blocks);
    var targetColumns = targetInfo.columns;
    var totalTargetPixels = targetInfo.totalPixels;
    var totalTargetSpools = Math.floor(totalTargetPixels / 3);

    // === 线轴匹配函数 ===
    // 模拟一个线轴在暂存区的匹配过程
    // 线轴有当前进度(0/1/2)，每次扫描输出端第一行从左到右找同色
    // 返回消除了几个像素（0~3），如果消满3个=完成订单
    // 修正版：一轮从左到右扫描，每列最多消1个同色
    // 一轮结束后如果有消除（栈顶变了），再进行下一轮
    function matchSpoolInBuffer(colorId, progress, tCols) {
      var eliminated = 0;
      var needed = 3 - progress;
      if (needed <= 0) return 0;

      var changed = true;
      while (changed && eliminated < needed) {
        changed = false;
        for (var c = 0; c < tCols.length; c++) {
          if (eliminated >= needed) break;
          if (tCols[c].length > 0 && tCols[c][0] === colorId) {
            tCols[c].shift();
            eliminated++;
            changed = true;
            // 该列消了1个，继续下一列（一轮内每列最多1个）
          }
        }
        // 一轮结束，如果changed=true说明有列发生了变化，再循环检查
      }
      return eliminated;
    }

    // 预测一个颜色在当前输出端状态下能消几个（不修改状态）
    function peekMatch(colorId, progress, tCols) {
      var tempCols = [];
      for (var c = 0; c < tCols.length; c++) tempCols.push(tCols[c].slice());
      return matchSpoolInBuffer(colorId, progress, tempCols);
    }

    // === 构建棋盘球列表 ===
    var dist = bfsFromTopRow(spools, maprow, mapcol);

    var allBalls = [];
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (!spool) continue;

        if (spool.id > 0 && !isObstacle(spool) && dist[r][c] !== -1) {
          var types = Array.isArray(spool.type) ? spool.type : (spool.type === 0 ? [] : [spool.type]);
          allBalls.push({
            row: r, col: c,
            colorId: spool.id,
            dist: dist[r][c],
            source: 'cell',
            frozen: types.indexOf(4) !== -1,
            chain: types.indexOf(5) !== -1,
            question: types.indexOf(6) !== -1
          });
        }

        // 管道内球
        if (YarnLevel.isPipeType(spool.type) && Array.isArray(spool.param)) {
          var pipeDist = -1;
          var pDirs = [[-1,0],[1,0],[0,-1],[0,1]];
          for (var d = 0; d < pDirs.length; d++) {
            var nr = r + pDirs[d][0], nc = c + pDirs[d][1];
            if (nr >= 0 && nr < maprow && nc >= 0 && nc < mapcol && dist[nr][nc] !== -1) {
              if (pipeDist === -1 || dist[nr][nc] < pipeDist) pipeDist = dist[nr][nc];
            }
          }
          if (pipeDist !== -1) {
            for (var pi = 0; pi < spool.param.length; pi++) {
              var pid = spool.param[pi];
              if (pid > 0) {
                allBalls.push({
                  row: r, col: c,
                  colorId: pid,
                  dist: pipeDist,
                  source: 'pipe',
                  pipeIndex: pi,
                  frozen: false,
                  chain: false,
                  question: false
                });
              }
            }
          }
        }
      }
    }

    // === 管道状态管理 ===
    // 管道规则：
    // - 管道有朝向（↑↓←→），出口位置 = 管道朝向方向的相邻格
    // - 当出口位置的线轴被拾取走（格子空了），管道释放下一个球到出口位置
    // - 释放的球需要再被拾取后，管道才会释放下一个
    // - 所以管道内球的可取顺序完全取决于出口是否空闲
    
    var pipeInfos = []; // [{row, col, dir, exitRow, exitCol, param, nextRelease}]
    var pipeByExit = {}; // 'exitRow,exitCol' -> pipeInfo (哪个管道出口在这里)
    
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (spool && YarnLevel.isPipeType(spool.type) && Array.isArray(spool.param) && spool.param.length > 0) {
          var dir = YarnLevel.getPipeDirection(spool.type);
          var exitR = r, exitC = c;
          if (dir === 11) exitR = r - 1; // ↑
          else if (dir === 12) exitC = c + 1; // →
          else if (dir === 13) exitR = r + 1; // ↓
          else if (dir === 14) exitC = c - 1; // ←
          
          var info = {
            row: r, col: c,
            exitRow: exitR, exitCol: exitC,
            param: spool.param.slice(),
            nextRelease: 0, // 下一个要释放的索引
            exitOccupied: true // 出口初始是否有东西（如果出口格有线轴/冰块则占据）
          };
          pipeInfos.push(info);
          pipeByExit[exitR + ',' + exitC] = info;
        }
      }
    }
    
    // 记录哪些格子当前被占据（有线轴未被拾取）
    var occupiedCells = {}; // 'r,c' -> true
    for (var i = 0; i < allBalls.length; i++) {
      if (allBalls[i].source === 'cell') {
        occupiedCells[allBalls[i].row + ',' + allBalls[i].col] = true;
      }
    }
    
    // 管道释放的球会放到出口位置，作为新的可拾取线轴
    // 用一个数组跟踪管道释放出来的"待拾取"球
    var pipeReleasedBalls = []; // [{row, col, colorId, pipeRow, pipeCol, pipeIndex}]
    
    // 检查管道是否应该释放（出口空了）
    function checkPipeRelease() {
      for (var pi = 0; pi < pipeInfos.length; pi++) {
        var pipe = pipeInfos[pi];
        if (pipe.nextRelease >= pipe.param.length) continue; // 管道已空
        var exitKey = pipe.exitRow + ',' + pipe.exitCol;
        // 出口空了 = 没有普通线轴占据 && 没有管道释放的球等待拾取
        if (!occupiedCells[exitKey]) {
          // 释放下一个球到出口
          var colorId = pipe.param[pipe.nextRelease];
          pipeReleasedBalls.push({
            row: pipe.exitRow,
            col: pipe.exitCol,
            colorId: colorId,
            pipeRow: pipe.row,
            pipeCol: pipe.col,
            pipeIndex: pipe.nextRelease,
            source: 'pipe',
            frozen: false,
            chain: false,
            question: false,
            dist: 0 // 已经在出口了
          });
          occupiedCells[exitKey] = true; // 出口被新球占据
          pipe.nextRelease++;
        }
      }
    }

    // === 动态激活状态 ===
    // 游戏规则：初始只有第一行可拾取
    // 拾取一个格子后，它的上下左右四个相邻格被激活（变为可拾取）
    // 冰块被激活后进入"解冻待命"，还需3次全局拾取才可取
    
    // activated: 已激活的格子集合（可以被拾取或正在解冻）
    var activated = {}; // 'r,c' -> true
    // 第一行的非障碍格初始就激活
    for (var c = 0; c < mapcol; c++) {
      var s = spools[0] && spools[0][c];
      if (s && !isObstacle(s)) {
        activated['0,' + c] = true;
      }
    }

    // 冰块解冻状态
    // 冰块被激活后需要3次全局拾取才能解冻
    var frozenState = {}; // 'r,c' -> {activated: bool, thawProgress: number}
    for (var i = 0; i < allBalls.length; i++) {
      if (allBalls[i].frozen && allBalls[i].source === 'cell') {
        var fKey = allBalls[i].row + ',' + allBalls[i].col;
        frozenState[fKey] = {
          activated: !!activated[fKey], // 第一行冰块初始就激活
          thawProgress: (allBalls[i].row === 0 ? -1 : 0)  // 第一行冰块全局也需4步解冻
        };
      }
    }

    // 拾取一个格子后，激活其四方向相邻格
    function activateNeighbors(row, col) {
      var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (var d = 0; d < dirs.length; d++) {
        var nr = row + dirs[d][0], nc = col + dirs[d][1];
        if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
        var ns = spools[nr] && spools[nr][nc];
        if (!ns || isObstacle(ns)) continue;
        var nKey = nr + ',' + nc;
        if (!activated[nKey]) {
          activated[nKey] = true;
          // 如果是冰块，标记为激活（开始计算解冻）
          if (frozenState[nKey] && !frozenState[nKey].activated) {
            frozenState[nKey].activated = true;
          }
        }
      }
    }

    // 判断球是否当前可拾取
    function isBallAvailable(ball) {
      // 管道释放的球：在pipeReleasedBalls中就是可取的（它已经在出口位置了）
      if (ball.source === 'pipe') {
        // 管道球通过pipeReleasedBalls管理，不在这里判断
        return false; // 普通remaining中的管道球标记为不可取，用pipeReleasedBalls代替
      }
      var cellKey = ball.row + ',' + ball.col;
      // 必须已被激活
      if (!activated[cellKey]) return false;
      // 冰块需要解冻完成
      if (ball.frozen) {
        var fs = frozenState[cellKey];
        if (!fs || !fs.activated) return false;
        if (fs.thawProgress < 3) return false;
        // 冰块解冻完了，继续检查是否还有锁链约束（不直接return）
      }
      // 锁链需要配对两端都激活
      if (ball.chain) {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        var partnerActivated = false;
        for (var d = 0; d < dirs.length; d++) {
          var nr = ball.row + dirs[d][0], nc = ball.col + dirs[d][1];
          if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue;
          var ns = spools[nr] && spools[nr][nc];
          if (!ns) continue;
          var ntypes = Array.isArray(ns.type) ? ns.type : [ns.type];
          if (ntypes.indexOf(5) !== -1) {
            // 找到配对锁链，检查它是否也激活了
            var partnerKey = nr + ',' + nc;
            if (activated[partnerKey]) {
              partnerActivated = true;
            }
            break;
          }
        }
        if (!partnerActivated) return false;
      }
      return true;
    }

    // === 自动释放暂存区 ===
    // 输出端变化时，暂存区所有线轴自动重试匹配
    function autoRelease(buffer, tCols) {
      var released = [];
      var changed = true;
      while (changed) {
        changed = false;
        for (var bi = buffer.length - 1; bi >= 0; bi--) {
          var item = buffer[bi];
          if (item.colorId <= 0) continue;
          var canElim = peekMatch(item.colorId, item.progress, tCols);
          if (canElim > 0) {
            var actual = matchSpoolInBuffer(item.colorId, item.progress, tCols);
            item.progress += actual;
            if (item.progress >= 3) {
              // 订单完成，离开暂存区
              released.push(buffer.splice(bi, 1)[0]);
            }
            changed = true; // 输出端变了，需要重新检查所有
          }
        }
      }
      return released;
    }

    // === 主模拟循环 ===
    var buffer = [];
    var stepBufferHistory = [];
    var totalSteps = 0;
    var eliminatedSpools = 0;
    var pickOrder = [];
    // remaining只包含普通格子球（管道球通过pipeReleasedBalls管理）
    var remaining = [];
    for (var i = 0; i < allBalls.length; i++) {
      if (allBalls[i].source !== 'pipe') {
        remaining.push(allBalls[i]);
      }
    }
    var globalPickCount = 0;

    // 初始检查管道释放
    checkPipeRelease();

    var MAX_ITER = 600;

    var MAX_ITER = 600;

    // === 单步评分函数（精确模拟） ===
    function evalStep(ballColorId, ballChain, ballRow, ballCol, currentBuffer, tCols, currentBufferLength) {
      var tc = [];
      for (var i = 0; i < tCols.length; i++) tc.push(tCols[i].slice());
      var elim = matchSpoolInBuffer(ballColorId, 0, tc);
      var tb = [];
      for (var i = 0; i < currentBuffer.length; i++) {
        tb.push({ colorId: currentBuffer[i].colorId, progress: currentBuffer[i].progress });
      }
      if (elim < 3) tb.push({ colorId: ballColorId, progress: elim });
      var ch = true;
      while (ch) { ch = false; for (var i = tb.length - 1; i >= 0; i--) { var it = tb[i]; var m = 0; for (var c = 0; c < tc.length && m < (3 - it.progress); c++) { if (tc[c].length > 0 && tc[c][0] === it.colorId) { tc[c].shift(); m++; } } if (m > 0) { it.progress += m; if (it.progress >= 3) tb.splice(i, 1); ch = true; } } }
      var simFinal = tb.length;
      var delta = simFinal - currentBufferLength;
      var score = 0;
      if (delta <= -2) score = 30;
      else if (delta === -1) score = 25;
      else if (delta === 0) score = 20;
      else if (delta === 1) { score = currentBufferLength <= 2 ? -3 : (currentBufferLength <= 3 ? -8 : -20); }
      else { score = currentBufferLength <= 1 ? -5 : (currentBufferLength <= 3 ? -15 : -25); }
      // 同色积压
      if (elim < 3) { for (var i = 0; i < currentBuffer.length; i++) { if (currentBuffer[i].colorId === ballColorId) score -= 8; } }
      return { score: score, simFinal: simFinal, tempCols: tc, tempBuffer: tb };
    }

    for (var iter = 0; iter < MAX_ITER; iter++) {
      var available = [];
      for (var i = 0; i < remaining.length; i++) { if (isBallAvailable(remaining[i])) available.push({ idx: i, ball: remaining[i], fromPipe: false }); }
      for (var i = 0; i < pipeReleasedBalls.length; i++) { var prb = pipeReleasedBalls[i]; if (activated[prb.row + ',' + prb.col]) available.push({ idx: i, ball: prb, fromPipe: true }); }
      if (available.length === 0) {
        console.log('[Solver] STUCK at step', totalSteps, 'buffer:', buffer.length, 'remaining:', remaining.length, 'pipeReleased:', pipeReleasedBalls.length);
        // 检查是否有球因为冰块/锁链未就绪而不可取
        var blockedReasons = {};
        for (var i = 0; i < remaining.length; i++) {
          var b = remaining[i]; var bk = b.row+','+b.col;
          if (!activated[bk]) { blockedReasons['not_activated'] = (blockedReasons['not_activated']||0)+1; continue; }
          if (b.frozen) { var fs = frozenState[bk]; if (!fs||!fs.activated||fs.thawProgress<3) { blockedReasons['frozen'] = (blockedReasons['frozen']||0)+1; continue; } }
          if (b.chain) { blockedReasons['chain_blocked'] = (blockedReasons['chain_blocked']||0)+1; continue; }
          blockedReasons['unknown'] = (blockedReasons['unknown']||0)+1;
        }
        console.log('[Solver] blocked reasons:', JSON.stringify(blockedReasons));
        break;
      }

      // === 收尾穷举模式：剩余球少时暴力搜索最优顺序 ===
      if (available.length <= 8 && available.length >= 1 && (remaining.length + pipeReleasedBalls.length) <= 15) {
        // 用DFS穷举：尝试所有取球顺序，找能让暂存不爆的路径
        var bestExhaustIdx = -1;
        var bestExhaustScore = -Infinity;
        
        for (var exi = 0; exi < available.length; exi++) {
          var exBall = available[exi].ball;
          // 精确模拟这个球
          var exEv = evalStep(exBall.colorId, exBall.chain, exBall.row, exBall.col, buffer, targetColumns, buffer.length);
          if (exEv.simFinal >= BUFFER_LIMIT) continue; // 会死
          
          // 深度搜索：模拟取了这个球后，后续能走多深（不死）
          var depthScore = exEv.score;
          
          // 模拟后续5步看能走多远
          var simTc = exEv.tempCols;
          var simBuf = exEv.tempBuffer;
          var simBufLen = exEv.simFinal;
          var survived = true;
          var futureScore = 0;
          
          // 收集后续available（排除当前球）
          var futureAvail = [];
          for (var fa = 0; fa < available.length; fa++) {
            if (fa === exi) continue;
            futureAvail.push(available[fa].ball);
          }
          // 新激活的球也加入
          if (exBall.source === 'cell') {
            var exDirs = [[-1,0],[1,0],[0,-1],[0,1]];
            for (var ed = 0; ed < exDirs.length; ed++) {
              var enr = exBall.row+exDirs[ed][0], enc = exBall.col+exDirs[ed][1];
              if (enr<0||enr>=maprow||enc<0||enc>=mapcol) continue;
              if (activated[enr+','+enc]) continue;
              var ens = spools[enr]&&spools[enr][enc];
              if (!ens||isObstacle(ens)||ens.id<=0) continue;
              var ent = Array.isArray(ens.type)?ens.type:[ens.type];
              if (ent.indexOf(4)!==-1) continue; // 冰块不可立即取
              futureAvail.push({colorId:ens.id, row:enr, col:enc, source:'cell'});
            }
          }
          
          // 模拟后续最多5步
          for (var step = 0; step < 5 && futureAvail.length > 0; step++) {
            // 找最优的下一步
            var bestNext = -1; var bestNextScore = -Infinity;
            for (var fi = 0; fi < futureAvail.length; fi++) {
              var fb = futureAvail[fi];
              var fpm = peekMatch(fb.colorId, 0, simTc);
              var fDelta = (fpm >= 3) ? 0 : 1;
              if (simBufLen + fDelta >= BUFFER_LIMIT) continue; // 会死
              var fs = fpm >= 3 ? 20 : (fpm >= 1 ? 5 : -5);
              if (fs > bestNextScore) { bestNextScore = fs; bestNext = fi; }
            }
            if (bestNext === -1) { survived = (simBufLen < BUFFER_LIMIT); break; }
            futureScore += bestNextScore;
            // 简化模拟
            var nfb = futureAvail[bestNext];
            var nfpm = peekMatch(nfb.colorId, 0, simTc);
            if (nfpm >= 3) { matchSpoolInBuffer(nfb.colorId, 0, simTc); }
            else { simBufLen++; matchSpoolInBuffer(nfb.colorId, 0, simTc); }
            futureAvail.splice(bestNext, 1);
          }
          
          if (!survived) continue; // 这条路径会死
          var totalExScore = depthScore + futureScore;
          if (totalExScore > bestExhaustScore) { bestExhaustScore = totalExScore; bestExhaustIdx = exi; }
        }
        
        if (bestExhaustIdx >= 0) {
          bestIdx = bestExhaustIdx;
          // 跳过后续通道/前瞻逻辑，直接执行
        }
      }
      
      // 如果穷举已选定，跳过后续决策
      if (bestIdx >= 0) {
        // 直接去执行
      } else {

      // 通道检测
      var hasUnresolvedCorridor = false;
      for (var coKey in corridorObstacleSet) { if (corridorObstacleSet[coKey].type === 'normal') continue; if (!occupiedCells[coKey]) continue; if (frozenState[coKey] && frozenState[coKey].thawProgress >= 3) continue; hasUnresolvedCorridor = true; break; }
      if (!hasUnresolvedCorridor && highPriorityMode) { var uac = 0; for (var ck in corridorCellSet) { if (!activated[ck] && occupiedCells[ck]) uac++; } if (uac > 3) hasUnresolvedCorridor = true; }
      var corridorClearingMode = highPriorityMode && hasUnresolvedCorridor;

      // corridorDirection BFS
      var corridorDirection = {};
      if (corridorClearingMode) {
        var ce = [];
        for (var ck in corridorCellSet) { if (activated[ck] && occupiedCells[ck]) ce.push(ck); }
        for (var coK in corridorObstacleSet) { if (!activated[coK]) { var p = coK.split(','); var dd = [[-1,0],[1,0],[0,-1],[0,1]]; for (var d = 0; d < dd.length; d++) { var ek = (parseInt(p[0])+dd[d][0])+','+(parseInt(p[1])+dd[d][1]); if (activated[ek] && occupiedCells[ek]) ce.push(ek); } } }
        var cdV = {}; var cdQ = [];
        for (var i = 0; i < ce.length; i++) { if (!cdV[ce[i]]) { cdV[ce[i]] = true; corridorDirection[ce[i]] = 0; cdQ.push(ce[i]); } }
        while (cdQ.length > 0) { var cur = cdQ.shift(); var cp = cur.split(','); var dd = [[-1,0],[1,0],[0,-1],[0,1]]; for (var d = 0; d < dd.length; d++) { var nk = (parseInt(cp[0])+dd[d][0])+','+(parseInt(cp[1])+dd[d][1]); if (cdV[nk]) continue; var ns = spools[parseInt(cp[0])+dd[d][0]] && spools[parseInt(cp[0])+dd[d][0]][parseInt(cp[1])+dd[d][1]]; if (!ns || isObstacle(ns) || !activated[nk]) continue; cdV[nk] = true; corridorDirection[nk] = corridorDirection[cur] + 1; cdQ.push(nk); } }
      }

      var bestIdx = -1;

      // === 暂存>=5：独立精确模拟 ===
      if (buffer.length >= 5) {
        var bestCS = -Infinity;
        for (var ai = 0; ai < available.length; ai++) {
          var b5 = available[ai].ball; if (b5.question) continue;
          var ev5 = evalStep(b5.colorId, b5.chain, b5.row, b5.col, buffer, targetColumns, buffer.length);
          if (ev5.simFinal >= BUFFER_LIMIT) continue;
          var cs = (buffer.length - ev5.simFinal) * 100 + ev5.score;
          if (cs > bestCS) { bestCS = cs; bestIdx = ai; }
        }
        if (bestIdx === -1) {
          // 精确模拟全部>=6：降级——选能部分消除的（peekMatch>=1），实际执行时autoRelease可能会救
          var bestPeek = -1; var bestPeekVal = 0;
          for (var ai = 0; ai < available.length; ai++) {
            var fb = available[ai].ball; if (fb.question) continue;
            var pm = peekMatch(fb.colorId, 0, targetColumns);
            if (pm > bestPeekVal) { bestPeekVal = pm; bestPeek = ai; }
          }
          if (bestPeek >= 0) { bestIdx = bestPeek; }
          else {
            // 连部分消都没有：选任意一个强制执行
            for (var ai = 0; ai < available.length; ai++) { if (!available[ai].ball.question) { bestIdx = ai; break; } }
            if (bestIdx === -1) break;
          }
        }
      }

      // === 暂存<5：决策 ===
      if (buffer.length < 5 && bestIdx === -1) {
        
        // ============================================================
        // 通道模式：独立决策逻辑（不走3步前瞻）
        // ============================================================
        if (corridorClearingMode) {
          var bestCorrScore = -Infinity;
          for (var ai = 0; ai < available.length; ai++) {
            var ball = available[ai].ball; if (ball.question) continue;
            var ev = evalStep(ball.colorId, ball.chain, ball.row, ball.col, buffer, targetColumns, buffer.length);
            if (ev.simFinal >= BUFFER_LIMIT) continue;
            if (ev.simFinal >= 5) { var esc = false; for (var e = 0; e < available.length; e++) { if (e === ai) continue; var eb = available[e].ball; if (!eb.question && peekMatch(eb.colorId, 0, ev.tempCols) >= 3) { esc = true; break; } } if (!esc) continue; }

            var score = 0;
            var isToward = false;
            if (ball.source === 'cell') {
              var ck = ball.row + ',' + ball.col;
              if (corridorCellSet[ck] || corridorObstacleSet[ck]) isToward = true;
              if (corridorDirection[ck] !== undefined && corridorDirection[ck] <= 2) isToward = true;
              var dd = [[-1,0],[1,0],[0,-1],[0,1]];
              for (var d = 0; d < dd.length; d++) { var nk = (ball.row+dd[d][0])+','+(ball.col+dd[d][1]); if (!activated[nk] && (corridorCellSet[nk] || corridorObstacleSet[nk])) isToward = true; }
            }

            if (isToward) {
              // 朝通道方向
              if (ev.score >= 20) score = 50; // 朝通道+能消=最佳
              else if (buffer.length <= 3) score = 30; // 暂存安全，大胆冲
              else score = 15; // 暂存=4，谨慎但仍优先通道
            } else {
              // 非通道方向：只在能消时考虑
              if (ev.score >= 20) {
                // 能消：根据暂存压力
                if (buffer.length >= 3) score = 25; // 暂存有压力，消除很重要
                else score = 10; // 暂存安全，让位给通道
              } else {
                score = -10; // 不朝通道也不能消，低优先
              }
            }
            if (score > bestCorrScore) { bestCorrScore = score; bestIdx = ai; }
          }

        } else {
        // ============================================================
        // 正常模式：纯3步树形前瞻（无通道加分）
        // ============================================================
        var bestTotal = -Infinity;
        for (var ai = 0; ai < available.length; ai++) {
          var ball = available[ai].ball;
          // 问号球也正常评估（它有颜色id，只是显示为问号）
          var ev1 = evalStep(ball.colorId, ball.chain, ball.row, ball.col, buffer, targetColumns, buffer.length);
          if (ev1.simFinal >= BUFFER_LIMIT) continue;
          if (ev1.simFinal >= 5) { var esc = false; for (var e = 0; e < available.length; e++) { if (e === ai) continue; var eb = available[e].ball; if (!eb.question && peekMatch(eb.colorId, 0, ev1.tempCols) >= 3) { esc = true; break; } } if (!esc) continue; }
          if (ev1.simFinal >= 4 && ev1.simFinal > buffer.length) { var esc4 = false; for (var e = 0; e < available.length; e++) { if (e === ai) continue; var eb = available[e].ball; if (!eb.question && peekMatch(eb.colorId, 0, ev1.tempCols) >= 3) { esc4 = true; break; } } if (!esc4) continue; }

          var s1 = ev1.score;

          // 第2步候选
          var s2Cands = [];
          var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
          if (ball.source === 'cell') {
            for (var d = 0; d < dirs.length; d++) { var nr = ball.row+dirs[d][0], nc = ball.col+dirs[d][1]; if (nr < 0 || nr >= maprow || nc < 0 || nc >= mapcol) continue; var nk = nr+','+nc; if (activated[nk]) continue; var ns = spools[nr] && spools[nr][nc]; if (!ns || isObstacle(ns) || ns.id <= 0) continue; var nt = Array.isArray(ns.type)?ns.type:[ns.type]; if (nt.indexOf(4)!==-1) continue; s2Cands.push({colorId:ns.id,row:nr,col:nc}); }
          }
          for (var pi = 0; pi < pipeInfos.length; pi++) { var pipe = pipeInfos[pi]; if (pipe.exitRow+','+pipe.exitCol === ball.row+','+ball.col && pipe.nextRelease < pipe.param.length) s2Cands.push({colorId:pipe.param[pipe.nextRelease],row:pipe.exitRow,col:pipe.exitCol}); }
          for (var e = 0; e < available.length; e++) { if (e === ai) continue; var eb = available[e].ball; if (!eb.question) s2Cands.push({colorId:eb.colorId,row:eb.row,col:eb.col}); }

          // top3第2步
          var s2Scored = [];
          for (var i = 0; i < s2Cands.length; i++) { var pm = peekMatch(s2Cands[i].colorId, 0, ev1.tempCols); s2Scored.push({idx:i, qs: pm>=3?20:(pm>=1?5:-5)}); }
          s2Scored.sort(function(a,b){return b.qs-a.qs;});
          var top3 = s2Scored.slice(0, 3);

          var best23 = -100;
          for (var t = 0; t < top3.length; t++) {
            var c2 = s2Cands[top3[t].idx];
            var ev2 = evalStep(c2.colorId, false, c2.row, c2.col, ev1.tempBuffer, ev1.tempCols, ev1.simFinal);
            var s2 = ev2.score;

            // 第3步
            var s3Cands = [];
            for (var d = 0; d < dirs.length; d++) { var nr3 = c2.row+dirs[d][0], nc3 = c2.col+dirs[d][1]; if (nr3<0||nr3>=maprow||nc3<0||nc3>=mapcol) continue; var nk3 = nr3+','+nc3; if (activated[nk3] || nk3===ball.row+','+ball.col) continue; var ns3 = spools[nr3]&&spools[nr3][nc3]; if (!ns3||isObstacle(ns3)||ns3.id<=0) continue; var nt3=Array.isArray(ns3.type)?ns3.type:[ns3.type]; if(nt3.indexOf(4)!==-1) continue; s3Cands.push({colorId:ns3.id}); }
            for (var e = 0; e < available.length; e++) { if (e === ai) continue; var eb = available[e].ball; if (!eb.question && !(eb.row===c2.row&&eb.col===c2.col)) s3Cands.push({colorId:eb.colorId}); }

            var bestS3 = 0;
            for (var i = 0; i < Math.min(s3Cands.length, 5); i++) { var pm3 = peekMatch(s3Cands[i].colorId, 0, ev2.tempCols); var qs3 = pm3>=3?20:(pm3>=1?3:-5); if (qs3 > bestS3) bestS3 = qs3; }

            var path23 = s2 + bestS3;
            if (path23 > best23) best23 = path23;
          }
          if (top3.length === 0) best23 = 0;

          var totalScore = s1 + best23;
          if (totalScore > bestTotal) { bestTotal = totalScore; bestIdx = ai; }
        }
        } // 关闭 else（正常模式）
      }

      // 降级
      if (bestIdx === -1) {
        if (buffer.length > 0) { var rel = autoRelease(buffer, targetColumns); if (rel.length > 0) { eliminatedSpools += rel.length; continue; } }
        var mf = 999; for (var fb = 0; fb < available.length; fb++) { var fbb = available[fb].ball; if (fbb.question) continue; var fpm = peekMatch(fbb.colorId, 0, targetColumns); var fpred = buffer.length + (fpm >= 3 ? 0 : 1); if (fpred < mf) { mf = fpred; bestIdx = fb; } }
        if (bestIdx === -1) {
          console.log('[Solver] FALLBACK FAILED at step', totalSteps, 'available:', available.length, 'buffer:', buffer.length);
          // 如果available有球但全是question，强制选第一个
          if (available.length > 0) { bestIdx = 0; }
          else break;
        }
      }
      } // 关闭 if (bestIdx >= 0) else 块

      // === 执行 ===
      var chosenAvail = available[bestIdx];
      var chosenBall = chosenAvail.ball;
      var fromPipe = chosenAvail.fromPipe;
      if (fromPipe) pipeReleasedBalls.splice(chosenAvail.idx, 1); else remaining.splice(chosenAvail.idx, 1);
      totalSteps++; globalPickCount++;
      var pickedKey = chosenBall.row + ',' + chosenBall.col;
      delete occupiedCells[pickedKey];
      for (var fKey in frozenState) { var fs = frozenState[fKey]; if (fs.activated && fs.thawProgress < 3) fs.thawProgress++; }
      if (chosenBall.source === 'cell' || fromPipe) activateNeighbors(chosenBall.row, chosenBall.col);
      checkPipeRelease();

      var chainPartner = null;
      if (chosenBall.chain && chosenBall.source === 'cell') {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) { var nr = chosenBall.row+dirs[d][0], nc = chosenBall.col+dirs[d][1]; if (nr<0||nr>=maprow||nc<0||nc>=mapcol) continue; for (var ri = 0; ri < remaining.length; ri++) { var rb = remaining[ri]; if (rb.row===nr&&rb.col===nc&&rb.chain&&rb.source==='cell') { chainPartner = {idx:ri,ball:rb}; break; } } if (chainPartner) break; }
      }

      var colorId = chosenBall.colorId;
      var newItem = { colorId: colorId, progress: 0, step: totalSteps, row: chosenBall.row, col: chosenBall.col };
      if (colorId > 0) { var ec = matchSpoolInBuffer(colorId, 0, targetColumns); newItem.progress = ec; if (ec >= 3) eliminatedSpools++; else buffer.push(newItem); } else buffer.push(newItem);
      var relM = autoRelease(buffer, targetColumns); eliminatedSpools += relM.length;

      if (chainPartner) {
        remaining.splice(chainPartner.idx, 1);
        delete occupiedCells[chainPartner.ball.row+','+chainPartner.ball.col];
        activateNeighbors(chainPartner.ball.row, chainPartner.ball.col);
        checkPipeRelease();
        var pc = chainPartner.ball.colorId;
        var pi2 = { colorId: pc, progress: 0, step: totalSteps, row: chainPartner.ball.row, col: chainPartner.ball.col };
        if (pc > 0) { var pe = matchSpoolInBuffer(pc, 0, targetColumns); pi2.progress = pe; if (pe >= 3) eliminatedSpools++; else buffer.push(pi2); } else buffer.push(pi2);
        pickOrder.push({ step: totalSteps, row: chainPartner.ball.row, col: chainPartner.ball.col, colorId: pc, colorName: pc > 0 ? YarnLevel.getColorName(pc) : '问号', source: 'cell', dist: chainPartner.ball.dist, bufferAfter: buffer.length, isFrozen: false, note: '锁链配对' });
      }

      var relF = autoRelease(buffer, targetColumns); eliminatedSpools += relF.length;
      if (buffer.length >= BUFFER_LIMIT) { var emR = autoRelease(buffer, targetColumns); eliminatedSpools += emR.length; }
      stepBufferHistory.push(buffer.length);

      pickOrder.push({ step: totalSteps, row: chosenBall.row, col: chosenBall.col, colorId: chosenBall.colorId, colorName: chosenBall.colorId > 0 ? YarnLevel.getColorName(chosenBall.colorId) : '问号', source: chosenBall.source, pipeRow: chosenBall.pipeRow, pipeCol: chosenBall.pipeCol, pipeIndex: chosenBall.pipeIndex, dist: chosenBall.dist, bufferAfter: buffer.length, isFrozen: chosenBall.frozen, note: chosenBall.frozen ? '解冻后取出' : (chosenBall.chain ? '锁链' : (fromPipe ? '管道释放' : '')) });

      var rp = 0; for (var tc = 0; tc < targetColumns.length; tc++) rp += targetColumns[tc].length;
      if (rp === 0 && buffer.length === 0) break;
    }

    // === 计算结果 ===
    var progress = totalTargetSpools > 0 ? Math.round(eliminatedSpools / totalTargetSpools * 100) : 0;

    // 平均暂存占用 = 每步暂存占用之和 / 总步数
    var totalBufferUsage = 0;
    for (var i = 0; i < stepBufferHistory.length; i++) {
      totalBufferUsage += stepBufferHistory[i];
    }
    var avgBuffer = totalSteps > 0 ? (totalBufferUsage / totalSteps) : 0;
    var avgBufferRatio = totalSteps > 0 ? (totalBufferUsage / totalSteps / BUFFER_LIMIT) : 0;

    var maxBuffer = 0;
    for (var i = 0; i < stepBufferHistory.length; i++) {
      if (stepBufferHistory[i] > maxBuffer) maxBuffer = stepBufferHistory[i];
    }

    // === 顺序合法性检验 ===
    // 模拟验证：按pickOrder顺序，检查每一步是否真的可以执行
    var validationErrors = [];
    var vActivated = {}; // 验证用激活状态
    var vFrozen = {}; // 验证用冰块状态
    var vPipeStates = {}; // 验证用管道状态
    var vGlobalPick = 0;

    // 初始化第一行激活
    for (var vc = 0; vc < mapcol; vc++) {
      var vs = spools[0] && spools[0][vc];
      if (vs && !isObstacle(vs)) {
        vActivated['0,' + vc] = true;
      }
    }
    // 初始化冰块
    for (var vi = 0; vi < allBalls.length; vi++) {
      if (allBalls[vi].frozen && allBalls[vi].source === 'cell') {
        var vfk = allBalls[vi].row + ',' + allBalls[vi].col;
        vFrozen[vfk] = { activated: !!vActivated[vfk], thawProgress: (allBalls[vi].row === 0 ? -1 : 0) };
      }
    }
    // 初始化管道
    for (var vr = 0; vr < maprow; vr++) {
      for (var vcc = 0; vcc < mapcol; vcc++) {
        var vs2 = spools[vr] && spools[vr][vcc];
        if (vs2 && YarnLevel.isPipeType(vs2.type) && Array.isArray(vs2.param)) {
          vPipeStates[vr + ',' + vcc] = 0;
        }
      }
    }

    for (var vi = 0; vi < pickOrder.length; vi++) {
      var po = pickOrder[vi];
      var poKey = po.row + ',' + po.col;

      // 检查是否可执行
      if (po.source === 'pipe') {
        // 管道释放的球位于出口位置，只要出口已激活即合法
        if (!vActivated[poKey]) {
          validationErrors.push({ step: po.step, row: po.row, col: po.col, error: '管道出口未激活' });
        }
      } else {
        // 普通格子：必须已激活
        if (!vActivated[poKey]) {
          validationErrors.push({ step: po.step, row: po.row, col: po.col, error: '格子未激活（不可达）' });
        }
        // 冰块：必须已解冻
        if (vFrozen[poKey]) {
          if (!vFrozen[poKey].activated) {
            validationErrors.push({ step: po.step, row: po.row, col: po.col, error: '冰块未被激活' });
          } else if (vFrozen[poKey].thawProgress < 3) {
            validationErrors.push({ step: po.step, row: po.row, col: po.col, error: '冰块未解冻(进度' + vFrozen[poKey].thawProgress + '/3)' });
          }
        }
      }

      // 模拟执行这一步
      vGlobalPick++;
      // 推进管道
      for (var vpk in vPipeStates) {
        var vps = vpk.split(',');
        var vpSpool = spools[parseInt(vps[0])] && spools[parseInt(vps[0])][parseInt(vps[1])];
        if (vpSpool && Array.isArray(vpSpool.param) && vPipeStates[vpk] < vpSpool.param.length) {
          vPipeStates[vpk]++;
        }
      }
      // 推进冰块解冻
      for (var vfk2 in vFrozen) {
        if (vFrozen[vfk2].activated && vFrozen[vfk2].thawProgress < 3) {
          vFrozen[vfk2].thawProgress++;
        }
      }
      // 激活相邻格
      if (po.source === 'cell') {
        var vDirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var vd = 0; vd < vDirs.length; vd++) {
          var vnr = po.row + vDirs[vd][0], vnc = po.col + vDirs[vd][1];
          if (vnr < 0 || vnr >= maprow || vnc < 0 || vnc >= mapcol) continue;
          var vns = spools[vnr] && spools[vnr][vnc];
          if (vns && !isObstacle(vns)) {
            var vnKey = vnr + ',' + vnc;
            if (!vActivated[vnKey]) {
              vActivated[vnKey] = true;
              if (vFrozen[vnKey] && !vFrozen[vnKey].activated) {
                vFrozen[vnKey].activated = true;
              }
            }
          }
        }
      }
    }

    return {
      totalSteps: totalSteps,
      totalTargetSpools: totalTargetSpools,
      eliminatedSpools: eliminatedSpools,
      progress: Math.min(progress, 100),
      maxBuffer: maxBuffer,
      avgBuffer: parseFloat(avgBuffer.toFixed(2)),
      avgBufferRatio: parseFloat((avgBufferRatio * 100).toFixed(1)),
      bufferLimit: BUFFER_LIMIT,
      bufferFinal: buffer.length,
      stepBufferHistory: stepBufferHistory,
      pickOrder: pickOrder,
      completed: progress >= 100 && buffer.length === 0,
      validationErrors: validationErrors,
      corridorAnalysis: corridorPlan
    };
  }

  // ==================== 公开接口 ====================
  // =========================================================================
  // 难度评分体系（用于评估关卡，固化以便拟合难关数据）
  // 两个正交的轴：
  //   轴二·客观难度：难度强度分(0-100) + 四档(简单/普通/困难/极难)
  //   轴一·曲线质量：复合压力曲线(暂存压力权重×滞留) 是否符合预设压力曲线
  //                  → 好关/合格/差关 + 诊断；收尾段(90-100%)不计入卡点判断
  // =========================================================================
  var DIFF_BANDS = 10;
  // 暂存高压分级权重：≤3无压力，4开始推演，5-6高压，7濒死
  function _hpWeight(b) { if (b <= 3) return 0; if (b === 4) return 1; if (b === 5) return 2; if (b === 6) return 3; return 4; }
  // ── 因子归一化分母（按 64-90 难批·高手档实测分布校准，使最难关接近满分1.0）──
  var _SPOOL_CAP = 180;   // [已弃用] 原因子1线轴数上界；f1 已移除，权重并入 f2
  var _RATIO_CAP = 50;    // 因子2：平均暂存占比%上界（实测max≈49）
  var _RES_CAP = 4.5;     // 因子3：平均滞留步数上界（实测max≈4.14）
  var _HP_CAP = 1.0;      // 因子4：每步平均高压权重上界（实测max≈1.0，全程维持高压才满分）

  /**
   * 计算某个求解结果的难度四因子与强度（0-100）
   */
  function _strengthOf(result) {
    var spools = result.totalTargetSpools || 0;
    var hist = result.stepBufferHistory || [];
    var n = hist.length;
    // f1(线轴数) 已移除：原 0.05 权重并入 f2(平均暂存占比)，新权重 0.45/0.20/0.35
    var f2 = Math.min((result.avgBufferRatio || 0) / _RATIO_CAP, 1);
    var f3 = Math.min((result.avgRawResidence || 0) / _RES_CAP, 1);
    var hpSum = 0;
    for (var s = 0; s < n; s++) hpSum += _hpWeight(hist[s]);
    var hpAvg = n > 0 ? hpSum / n : 0;
    var f4 = Math.min(hpAvg / _HP_CAP, 1);
    var strength = (0.45 * f2 + 0.2 * f3 + 0.35 * f4) * 100;
    return { strength: strength, f2: f2, f3: f3, f4: f4, spools: spools };
  }

  /**
   * 按球插值出 {curve0:每球结算时暂存, res0:该点暂存球平均滞留, N:总球数}
   * 进度轴=已结算订单球数；一步结算多球时按排空轨迹逐球摊开。
   */
  function _ballCurveOf(result) {
    var hist = result.stepBufferHistory || [];
    var elimH = result.stepElimHistory || [];
    var resH = result.stepResidenceHistory || [];
    var n = hist.length;
    var N = result.totalTargetSpools || 0;
    if (!(elimH.length === n && n > 0 && N > 0)) return { curve0: null, res0: null, N: N };
    var curve0 = new Array(N), res0 = new Array(N);
    for (var i = 0; i < N; i++) { curve0[i] = 0; res0[i] = 0; }
    var prevE = 0;
    for (var sc = 0; sc < n; sc++) {
      var Ecur = elimH[sc];
      var placed = hist[sc] + Ecur;
      var rv = resH.length === n ? resH[sc] : 0;
      for (var pp = prevE + 1; pp <= Ecur && pp <= N; pp++) {
        curve0[pp - 1] = placed - pp;
        res0[pp - 1] = rv;
      }
      if (Ecur > prevE) prevE = Ecur;
    }
    if (prevE < N) {
      var lastPlaced = hist[n - 1] + elimH[n - 1];
      var lastRv = resH.length === n ? resH[n - 1] : 0;
      for (var pf = prevE + 1; pf <= N; pf++) { curve0[pf - 1] = Math.max(0, lastPlaced - pf); res0[pf - 1] = lastRv; }
    }
    return { curve0: curve0, res0: res0, N: N };
  }

  // ── 前期压力上限规则（模块级，供判定与挑选共用）──
  //   菜鸟 novice：严格 <3.5（earlyAvgBuf≥3.5 即违规，前期必须明显低难度）
  //   高手 strong / 中级 mid：≤4.2（earlyAvgBuf>4.2 才违规；mid 暂沿用高手口径）
  var EARLY_RULES = {
    novice: { win: 0.05, limit: 3.5, incl: false },
    strong: { win: 0.05, limit: 4.2, incl: true },
    mid:    { win: 0.05, limit: 4.2, incl: true }
  };

  // 在一条按球曲线上判卡点/前期：目标区(50-90%)最高10%窗平均暂存≥4 算卡点；
  // 前期(0-50%)最高5%窗平均暂存超过该档上限即判前期峰值前移。返回窗口数值 + 合规标志 + 展示曲线。
  function _judgeCurve(curve0, res0, auditTier) {
    var rule = EARLY_RULES[auditTier] || EARLY_RULES.strong;
    var out = { capPointValid: false, earlyViolation: false,
      zoneAvgBuf: 0, zoneAvgRes: 0, earlyAvgBuf: 0, earlyAvgRes: 0,
      zoneBestStart: 0, W: 0, comp: [], rule: rule };
    if (!curve0 || !curve0.length) {
      for (var dz = 0; dz < DIFF_BANDS; dz++) out.comp.push(0);
      return out;
    }
    var M = curve0.length;
    var W = Math.max(1, Math.round(M * 0.15));         // 中后期卡点窗口 15%(原10%；放宽=要求卡点持续更久)
    var W_EARLY = Math.max(1, Math.round(M * rule.win)); // 前期窗口 5%
    out.W = W;
    function bestWindow(lo, hi, win) {
      var startMax = hi - win; if (startMax < lo) startMax = lo;
      var best = { start: lo, avgBuf: -1, avgRes: 0 };
      for (var s = lo; s <= startMax; s++) {
        var e = Math.min(s + win, hi); if (e <= s) continue;
        var sumB = 0, sumR = 0;
        for (var i = s; i < e; i++) { sumB += curve0[i]; sumR += (res0 ? res0[i] : 0); }
        var ab = sumB / (e - s), ar = sumR / (e - s);
        if (ab > best.avgBuf) best = { start: s, avgBuf: ab, avgRes: ar };
      }
      return best;
    }
    var half = Math.floor(M * 0.5), zHi = Math.floor(M * 0.9);
    var zw = bestWindow(half, zHi, W);
    out.zoneBestStart = zw.start; out.zoneAvgBuf = zw.avgBuf; out.zoneAvgRes = zw.avgRes;
    out.capPointValid = (zw.avgBuf >= 4);
    var ew = bestWindow(0, half, W_EARLY);
    out.earlyAvgBuf = ew.avgBuf; out.earlyAvgRes = ew.avgRes;
    out.earlyViolation = rule.incl ? (ew.avgBuf > rule.limit) : (ew.avgBuf >= rule.limit);
    for (var d = 0; d < DIFF_BANDS; d++) {
      var dl = Math.floor(M * d / DIFF_BANDS), dh = Math.floor(M * (d + 1) / DIFF_BANDS);
      var s2 = 0, dn = 0; for (var di = dl; di < dh; di++) { s2 += curve0[di]; dn++; }
      out.comp.push(parseFloat((dn > 0 ? s2 / dn : 0).toFixed(2)));
    }
    return out;
  }

  // 从多遍求解里挑"最好的一遍"作为导出/展示解法：
  // 通关 且 个体符合(前期<阈值 且 目标区有卡点≥4) 的几遍中前期最低；若无个体完全符合者，则通关里前期最低。
  function _selectBestRun(runsArr, auditTier) {
    if (!runsArr || !runsArr.length) return null;
    var completed = runsArr.filter(function(r){ return r && r.completed; });
    var pool = completed.length ? completed : runsArr.slice();
    var scored = pool.map(function(r){
      var bc = _ballCurveOf(r);
      var jc = _judgeCurve(bc.curve0, bc.res0, auditTier);
      return { run: r, early: jc.earlyAvgBuf, ok: (jc.capPointValid && !jc.earlyViolation) };
    });
    var okOnes = scored.filter(function(s){ return s.ok; });
    var cand = okOnes.length ? okOnes : scored;
    cand.sort(function(a, b){ return a.early - b.early; }); // 前期 5% 窗均值最低优先
    return cand.length ? cand[0].run : null;
  }

  /**
   * 难度评分（基准档 + 全知版 融合）
   * 难度值按 0.8 基准档 + 0.2 全知 融合（基准档默认高手，可由 auditTier 切换为 novice/mid）。
   * 卡点压力曲线用「基准档(auditTier)」的按球曲线。
   * @param result 玩家求解结果（其 tiers[auditTier] 为审核基准档）
   * @param opts   { omniResult: 全知最优版结果, auditTier: 'strong'|'mid'|'novice' }
   */
  function computeDifficultyScore(result, opts) {
    opts = opts || {};
    var omni = opts.omniResult || null;
    // 趋势符合是否算合格(合格闸门开关)：默认 true=路线B(趋势符合无卡点也算合格)；
    // false=路线A(必须有真卡点 capPointValid 才算合格，趋势符合按无卡点处理 → 不合格)。
    var allowTrend = (opts.allowTrendCompliant !== false);
    var auditTier = opts.auditTier || result.auditTier || 'strong';
    var W_OMNI = 0.2, W_PLAYER = 0.8;

    // ===== 难度值：基准档 + 全知 融合（f1 线轴数已移除）=====
    var pS = _strengthOf(result);
    var f2, f3, f4, strengthRaw;
    if (omni) {
      var oS = _strengthOf(omni);
      f2 = W_PLAYER * pS.f2 + W_OMNI * oS.f2;
      f3 = W_PLAYER * pS.f3 + W_OMNI * oS.f3;
      f4 = W_PLAYER * pS.f4 + W_OMNI * oS.f4;
      strengthRaw = W_PLAYER * pS.strength + W_OMNI * oS.strength;
    } else {
      f2 = pS.f2; f3 = pS.f3; f4 = pS.f4; strengthRaw = pS.strength;
    }
    var spools = pS.spools;
    var strength = parseFloat(strengthRaw.toFixed(1));
    var tier = strength < 25 ? '简单' : (strength < 50 ? '普通' : (strength < 70 ? '困难' : '极难'));
    var isHardTier = (strength >= 70); // 极难档（保留原 ≥70 门槛触发"无难度卡点"判定）

    // ===== 卡点压力曲线：用「基准档(auditTier)」的按球曲线为基准 =====
    // 默认高手 = 信息受限的真人最佳表现（误触极低、3步前瞻），最能体现"这关被好好玩时"的压力结构；
    // 切换 auditTier 后则用对应档（如菜鸟）的按球曲线来判卡点/前期，使审核拟合该档真实水平。
    // 卡点是关卡的设计属性 → 用单档曲线；难度值仍用基准档加权融合(上面的 strength)，两者分离。
    var baseRes = (result.tiers && result.tiers[auditTier]) ? result.tiers[auditTier] : result;
    // 曲线来源：curveMode='avg' → 用基准档"3遍按球平均曲线"做稳定的合格判定；否则用该结果单遍曲线
    var curve0, res0, N;
    if (opts.curveMode === 'avg' && baseRes.ballCurveAvg && baseRes.ballCurveAvg.length) {
      curve0 = baseRes.ballCurveAvg; res0 = baseRes.ballResAvg || null; N = curve0.length;
    } else {
      var sc = _ballCurveOf(baseRes);
      curve0 = sc.curve0; res0 = sc.res0; N = sc.curve0 ? sc.curve0.length : 0;
    }
    // 在选定曲线上判卡点/前期（窗口逻辑统一收敛到 _judgeCurve）
    var jc = _judgeCurve(curve0, res0, auditTier);
    var capPointValid = jc.capPointValid, earlyViolation = jc.earlyViolation;
    var zoneBestStart = jc.zoneBestStart, W = jc.W;
    var zoneAvgBuf = jc.zoneAvgBuf, zoneAvgRes = jc.zoneAvgRes;
    var earlyAvgBuf = jc.earlyAvgBuf, earlyAvgRes = jc.earlyAvgRes;
    var earlyRule = jc.rule;
    var zoneHasHigh = capPointValid, earlyHasHigh = (earlyAvgBuf >= 4);
    var comp = jc.comp;

    // 卡点窗口标签（按球数换算回进度%）
    var peakBand = '-';
    if (curve0 && N > 0 && zoneHasHigh) {
      var bandLo = Math.round(zoneBestStart / N * 100);
      var bandHi = Math.round(Math.min(zoneBestStart + W, N) / N * 100);
      peakBand = bandLo + '-' + bandHi + '%';
    }

    // 符合预期 = 目标区有高压卡点 且 前期未前移
    var compliant = capPointValid && !earlyViolation;
    var quality = compliant ? '符合预期' : '不符合预期';
    var zoneTxt = '暂存' + zoneAvgBuf.toFixed(1) + '/滞留' + zoneAvgRes.toFixed(1);
    var earlyTxt = '暂存' + earlyAvgBuf.toFixed(1) + '/滞留' + earlyAvgRes.toFixed(1);


    // 三档玩家是否出现过暂存≥4（用于"无卡点"关的细分：正常简单关 vs 异常过于简单）
    // 降低标准：只看暂存≥4出现过（不要求滞留闸门），任一档出现即算正常简单关
    var anyTierHigh = false;
    var _tiers = result.tiers || null;
    if (_tiers) {
      var _tk = ['novice', 'mid', 'strong'];
      for (var _ti = 0; _ti < _tk.length; _ti++) {
        var _t = _tiers[_tk[_ti]];
        var _th = _t && _t.stepBufferHistory ? _t.stepBufferHistory : [];
        for (var _hi = 0; _hi < _th.length; _hi++) { if (_th[_hi] >= 4) { anyTierHigh = true; break; } }
        if (anyTierHigh) break;
      }
    } else {
      // 无分档数据时，退回看综合曲线是否出现过≥4
      for (var _ci = 0; curve0 && _ci < curve0.length; _ci++) { if (curve0[_ci] >= 4) { anyTierHigh = true; break; } }
    }

    // ===== 各档通关情况统计（尝试多次仍无法通关→标注）=====
    var tierPass = { novice: null, mid: null, strong: null };
    var failTiers = [], passTiers = [];
    var tierNameMap = { novice: '菜鸟', mid: '中级', strong: '高手' };
    if (_tiers) {
      var _tk2 = ['novice', 'mid', 'strong'];
      for (var _pi = 0; _pi < _tk2.length; _pi++) {
        var _tt = _tiers[_tk2[_pi]];
        if (!_tt) continue;
        var passed = (_tt.completed === true) || (typeof _tt.passRate === 'number' && _tt.passRate >= 50);
        tierPass[_tk2[_pi]] = passed;
        if (passed) passTiers.push(tierNameMap[_tk2[_pi]]);
        else failTiers.push(tierNameMap[_tk2[_pi]]);
      }
    }
    // 通关情况字符串 + 技术差距判定
    var tierClearNote = '';
    var skillGapBig = false;
    if (failTiers.length > 0) {
      // 例：菜鸟/中级 无法通关
      tierClearNote = failTiers.join('/') + ' 无法通关';
      // 有的档通关、有的档过不了 → 各水平难度差距大
      if (passTiers.length > 0) { skillGapBig = true; tierClearNote += '，各水平难度差距大'; }
    }

    // 问题类型标签（给美术调目标图用）
    var issueType = '';     // 前期持续高压 / 前期峰值前移 / 正常简单关 / 过于简单 / 趋势符合无卡点简单关 / ''
    var artNote = '';       // 美术可操作建议
    var diagnosis;

    // 趋势判定：无明确卡点(平均暂存<4)，但50-90%峰值窗口 > 0-50%峰值窗口 且 前期未越位
    var trendCompliant = false;
    if (!capPointValid && !earlyViolation && zoneAvgBuf > earlyAvgBuf) {
      trendCompliant = true; // 峰值确实在后半段，前期没越位
    }

    if (!curve0) {
      quality = '数据不足'; issueType = '数据不足';
      diagnosis = '缺少按球进度数据（stepElimHistory），无法判定曲线';
    } else if (compliant) {
      diagnosis = '符合预期：卡点落在 ' + peakBand + '（目标区' + zoneTxt + '），前期未前移';
      // 即使符合，若前期也已经是高压区，提示整体偏紧
      if (earlyHasHigh) {
        artNote = '前期(0-50%)也已出现高压区(' + earlyTxt + ')，整体偏紧，可酌情放松前期';
      }
    } else if (earlyViolation) {
      issueType = '前期峰值前移';
      var _baseName2 = tierNameMap[auditTier] || auditTier;
      var _limitTxt = earlyRule.incl ? ('≤' + earlyRule.limit) : ('<' + earlyRule.limit);
      diagnosis = '不符合：' + _baseName2 + '档前期(0-50%)最高5%窗口平均暂存' + earlyAvgBuf.toFixed(1)
                + '，超过该档前期上限(' + _limitTxt + ')，前期压力跳升';
      artNote = '高压重心落在前期，建议把目标图的复杂/密集区往 50-90% 进度方向后移';
    } else if (!capPointValid && trendCompliant && allowTrend) {
      // 无明确卡点但趋势对（后半段峰值>前半段，前期没越位）→ 趋势符合（仅当闸门允许趋势符合算合格时）
      issueType = '趋势符合无卡点简单关';
      quality = '趋势符合';
      compliant = true;  // 视为符合
      diagnosis = '趋势符合：无明确卡点(平均暂存' + zoneAvgBuf.toFixed(1) + '<4)，但50-90%峰值高于前期(' + zoneAvgBuf.toFixed(1) + '>' + earlyAvgBuf.toFixed(1) + ')，前期未越位';
      artNote = '';
    } else if (!capPointValid && isHardTier) {
      // 难度档高却无卡点且趋势也不对 → 仍按缺卡点处理
      issueType = '无难度卡点';
      quality = '不符合预期';
      diagnosis = '不符合：难度档偏高但 50-90% 无明显高压卡点（目标区' + zoneTxt + '，平均暂存未达4），且趋势不对';
      artNote = '难度档偏高但缺卡点节奏，建议在 50-90% 进度处集中布置同色/难抢色制造高压';
    } else if (!capPointValid) {
      // 简单/标准关无卡点且趋势不对：看审核基准档(auditTier)是否出现过暂存≥4
      var baseHigh = false;
      var _baseBuf = (baseRes && baseRes.stepBufferHistory) ? baseRes.stepBufferHistory : [];
      for (var _shi = 0; _shi < _baseBuf.length; _shi++) {
        if (_baseBuf[_shi] >= 4) { baseHigh = true; break; }
      }
      var _baseName = tierNameMap[auditTier] || auditTier;
      if (baseHigh) {
        issueType = '正常简单关';
        quality = '正常简单关';
        diagnosis = '正常简单关：无明显卡点且趋势不对，但' + _baseName + '档出现过暂存≥4的高压';
        artNote = '';
      } else {
        issueType = '过于简单';
        quality = '异常(过于简单)';
        diagnosis = '异常(过于简单)：' + _baseName + '档全程暂存 <4，几乎无任何压力';
        artNote = '关卡过于简单，' + _baseName + '都没碰到压力，建议增加同色密集/难抢色提升基础难度';
      }
    } else {
      diagnosis = '不符合预期曲线';
    }

    // 综合备注（难度档 + 是否符合 + 问题 + 建议），供挑关/转交美术
    var note = tier + ' / ' + quality;
    if (issueType) note += ' / ' + issueType;
    if (isHardTier && earlyViolation) note += '（全局难度高且前期偏难）';
    if (tierClearNote) note += ' / ' + tierClearNote;
    if (artNote) note += '｜调整建议：' + artNote;


    return {
      difficultyStrength: strength,
      difficultyTier: tier,
      auditTier: auditTier,
      totalSpools: spools,
      factors: {
        f2_bufRatio: parseFloat(f2.toFixed(3)),
        f3_residence: parseFloat(f3.toFixed(3)),
        f4_highPressure: parseFloat(f4.toFixed(3))
      },
      compositeCurve: comp,
      ballCurve: curve0 ? curve0.map(function(v){ return parseFloat(v.toFixed(2)); }) : null,  // 卡点曲线(高手档按球暂存)
      ballRes: res0 ? res0.map(function(v){ return parseFloat(v.toFixed(2)); }) : null,         // 对应按球滞留曲线(高手档)
      capWinStart: (curve0 && capPointValid) ? zoneBestStart : -1,                              // 卡点窗口起始球索引
      capWinLen: W,                                                                              // 窗口宽度(球数)
      peakBand: peakBand,
      peakValue: parseFloat((zoneAvgBuf > 0 ? zoneAvgBuf : 0).toFixed(2)),
      peakInZone: capPointValid,
      zoneAvgBuf: parseFloat((zoneAvgBuf > 0 ? zoneAvgBuf : 0).toFixed(2)),
      zoneAvgRes: parseFloat(zoneAvgRes.toFixed(2)),
      earlyAvgBuf: parseFloat((earlyAvgBuf > 0 ? earlyAvgBuf : 0).toFixed(2)),
      earlyAvgRes: parseFloat(earlyAvgRes.toFixed(2)),
      zoneHighRatio: parseFloat((zoneAvgBuf > 0 ? zoneAvgBuf : 0).toFixed(2)),
      zoneValid: capPointValid,
      earlyHighRatio: parseFloat((earlyAvgBuf > 0 ? earlyAvgBuf : 0).toFixed(2)),
      earlyViolation: earlyViolation,
      compliant: compliant,
      curveQuality: quality,
      issueType: issueType,
      artNote: artNote,
      note: note,
      tierPass: tierPass,
      tierClearNote: tierClearNote,
      skillGapBig: skillGapBig,
      diagnosis: diagnosis
    };
  }

  return {
    isObstacle: isObstacle,
    bfsFromTopRow: bfsFromTopRow,
    getDistanceToCell: getDistanceToCell,
    checkColorCounts: checkColorCounts,
    checkReachability: checkReachability,
    checkDeadlocks: checkDeadlocks,
    findPathsTopToBottom: findPathsTopToBottom,
    findBottlenecks: findBottlenecks,
    analyzeOptimalPlay: analyzeOptimalPlay,
    analyzeHardestPlay: analyzeHardestPlay,
    analyzeOptimalSolution: analyzeOptimalSolution,
    analyzePlayerSolution: analyzePlayerSolution,
    analyzePlayerTier: analyzePlayerTier,
    composePlayerTierResult: composePlayerTierResult,
    analyzePlayerSolutionAllTiers: analyzePlayerSolutionAllTiers,
    computeDifficultyScore: computeDifficultyScore,
    checkDeadlocksDeep: checkDeadlocksDeep
  };
})();
