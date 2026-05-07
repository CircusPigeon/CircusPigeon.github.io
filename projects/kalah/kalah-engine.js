/*
 * kalah-engine.js
 *
 * Pure-JS port of:
 *   - kalah.py       (game mechanics: empty-capture-OFF Kalah(6,4))
 *   - solver.py      (alpha-beta with transposition table + move ordering)
 *   - strategy.py    (P1's strategy WITHOUT the 15-stone tablebase, which
 *                    is commented out in the original Python)
 *
 * Lets the React frontend run fully client-side: no Flask backend needed.
 * Indexing convention matches the Python source — board is length-14:
 *   indices 0..5   = P0 houses (a.k.a. "P1" in the bot UI)
 *   index   6      = P0 store
 *   indices 7..12  = P1 houses (a.k.a. "P2" / the user)
 *   index   13     = P1 store
 */

(function (global) {
  "use strict";

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  var P0_STORE = 6;
  var P1_STORE = 13;
  var INF = 1e9;
  var EXPAND_DEPTH = 12; // matches app.py's EXPAND_DEPTH

  // ------------------------------------------------------------------
  // Game mechanics — port of kalah.py make_move (return value also
  // matches strategy.py's apply_move convention: nextPlayer is null on
  // game over).
  // ------------------------------------------------------------------
  function initialBoard() {
    return [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];
  }

  function legalMoves(board, player) {
    var out = [];
    if (player === 0) {
      for (var i = 0; i <= 5; i++) if (board[i] > 0) out.push(i);
    } else {
      for (var j = 7; j <= 12; j++) if (board[j] > 0) out.push(j);
    }
    return out;
  }

  function makeMove(board, player, house) {
    var b = board.slice();
    var seeds = b[house];
    b[house] = 0;
    var pos = house;
    var oppStore = player === 0 ? P1_STORE : P0_STORE;
    while (seeds > 0) {
      pos = (pos + 1) % 14;
      if (pos === oppStore) continue;
      b[pos] += 1;
      seeds -= 1;
    }

    // Capture: last seed in own previously-empty house, opposite non-empty.
    var ownLow = player === 0 ? 0 : 7;
    var ownHigh = player === 0 ? 5 : 12;
    var ownStore = player === 0 ? P0_STORE : P1_STORE;
    var captured = 0;
    var landedInOwnStore = pos === ownStore;
    if (!landedInOwnStore && pos >= ownLow && pos <= ownHigh && b[pos] === 1) {
      var opp = 12 - pos;
      if (b[opp] > 0) {
        captured = b[opp] + 1;
        b[ownStore] += captured;
        b[opp] = 0;
        b[pos] = 0;
      }
    }

    var extraTurn = landedInOwnStore;
    var nextPlayer = extraTurn ? player : 1 - player;

    var p0Empty = b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[4] === 0 && b[5] === 0;
    var p1Empty = b[7] === 0 && b[8] === 0 && b[9] === 0 && b[10] === 0 && b[11] === 0 && b[12] === 0;
    var gameOver = p0Empty || p1Empty;

    if (gameOver) {
      var s0 = 0, s1 = 0;
      for (var h0 = 0; h0 <= 5; h0++) { s0 += b[h0]; b[h0] = 0; }
      for (var h1 = 7; h1 <= 12; h1++) { s1 += b[h1]; b[h1] = 0; }
      b[P0_STORE] += s0;
      b[P1_STORE] += s1;
      nextPlayer = null;
    }

    return { board: b, nextPlayer: nextPlayer, gameOver: gameOver, captured: captured };
  }

  // ------------------------------------------------------------------
  // Alpha-beta with TT + move-ordering — port of solver.py
  // ------------------------------------------------------------------
  // The TT persists across calls so subsequent expansions reuse results.
  var _tt = new Map();

  function boardKey(board) {
    // Length-14 small-integer board → compact comma-joined string.
    return board.join(",");
  }
  function ttKey(board, player, depth) {
    return boardKey(board) + "|" + player + "|" + depth;
  }

  function alphabeta(board, player, depth, alpha, beta, gameOver) {
    if (gameOver || depth === 0) {
      return [board[P0_STORE] - board[P1_STORE], null];
    }
    var moves = legalMoves(board, player);
    if (moves.length === 0) {
      return [board[P0_STORE] - board[P1_STORE], null];
    }
    var key = ttKey(board, player, depth);
    var hit = _tt.get(key);
    if (hit !== undefined) return hit;

    // Move ordering: promote a shallower depth's best-move to the front.
    var ordered = moves;
    for (var d = depth - 1; d > 0; d--) {
      var prior = _tt.get(ttKey(board, player, d));
      if (prior !== undefined && prior[1] !== null && moves.indexOf(prior[1]) !== -1) {
        var bm = prior[1];
        ordered = [bm];
        for (var k = 0; k < moves.length; k++) {
          if (moves[k] !== bm) ordered.push(moves[k]);
        }
        break;
      }
    }

    var bestMove = ordered[0];
    var best;
    if (player === 0) {
      best = -INF;
      for (var i = 0; i < ordered.length; i++) {
        var m = ordered[i];
        var r = makeMove(board, player, m);
        var v = alphabeta(r.board, r.nextPlayer == null ? 0 : r.nextPlayer,
                          depth - 1, alpha, beta, r.gameOver)[0];
        if (v > best) { best = v; bestMove = m; }
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
    } else {
      best = INF;
      for (var ii = 0; ii < ordered.length; ii++) {
        var mm = ordered[ii];
        var rr = makeMove(board, player, mm);
        var vv = alphabeta(rr.board, rr.nextPlayer == null ? 0 : rr.nextPlayer,
                           depth - 1, alpha, beta, rr.gameOver)[0];
        if (vv < best) { best = vv; bestMove = mm; }
        if (best < beta) beta = best;
        if (alpha >= beta) break;
      }
    }

    var result = [best, bestMove];
    _tt.set(key, result);
    return result;
  }

  // ------------------------------------------------------------------
  // Tree node builder — port of tree.py make_node
  // ------------------------------------------------------------------
  function makeNode(nodeId, board, toMove, gameOver, depth) {
    if (gameOver) {
      return {
        id: nodeId,
        board: board.slice(),
        toMove: null,
        eval: board[P0_STORE] - board[P1_STORE],
        depth: depth,
        gameOver: true,
        children: null,
      };
    }
    // Iterative deepening warms the TT for move ordering at the final pass.
    for (var d = 2; d < depth; d += 2) {
      alphabeta(board, toMove, d, -INF, INF, false);
    }
    var v = alphabeta(board, toMove, depth, -INF, INF, false)[0];
    return {
      id: nodeId,
      board: board.slice(),
      toMove: toMove,
      eval: v,
      depth: depth,
      gameOver: false,
      children: null,
    };
  }

  // ------------------------------------------------------------------
  // /api/expand — port of app.py expand()
  // ------------------------------------------------------------------
  function expandNode(req) {
    var board = req.board.slice();
    var toMove = req.toMove | 0;
    var gameOver = !!req.gameOver;
    var nodeId = req.nodeId || "";

    if (gameOver) return { children: [] };

    var children = [];
    var moves = legalMoves(board, toMove);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var r = makeMove(board, toMove, m);
      var childId = nodeId ? (nodeId + "-" + m) : ("" + m);
      var child = makeNode(childId, r.board,
                           r.gameOver ? null : r.nextPlayer,
                           r.gameOver, EXPAND_DEPTH);
      children.push({ move: m, node: child });
    }
    return { children: children };
  }

  // ------------------------------------------------------------------
  // Strategy port — strategy.py without the tablebase
  // ------------------------------------------------------------------
  // strategy.py calls the bot "P1" with player index 0; the user is "P2"
  // with player index 1. For helpers below we keep that mental model:
  //   - In strategy code, "store of bot"  = board[6]  (P0_STORE)
  //   - In strategy code, "store of user" = board[13] (P1_STORE)

  var maxP2Cache = new Map();
  var evalCache = new Map();

  function getOpeningMove(board) {
    // 1. Turn 1: bot plays pit 3 (index 2).
    if (boardKey(board) === "4,4,4,4,4,4,0,4,4,4,4,4,4,0") return 2;
    // 2. Turn 1 (continuation after extra turn): play pit 6 (index 5).
    if (boardKey(board) === "4,4,0,5,5,5,1,4,4,4,4,4,4,0") return 5;
    // 3. Turn 2: after the 3 -> 6 opening, bot's store is exactly 2.
    if (board[P0_STORE] === 2 && board[5] === 0 && board[4] >= 5) {
      var canCaptureWithPit1 = board[0] === 5 && board[7] > 0;
      if (!canCaptureWithPit1) return 4;
      // else fall through to heuristic
    }
    return null;
  }

  function maxP2StoreAfterTurn(board) {
    var key = boardKey(board);
    var cached = maxP2Cache.get(key);
    if (cached !== undefined) return cached;
    var bestStore = board[P1_STORE];
    var moves = legalMoves(board, 1);
    for (var i = 0; i < moves.length; i++) {
      var r = makeMove(board, 1, moves[i]);
      var store;
      if (!r.gameOver && r.nextPlayer === 1) {
        store = maxP2StoreAfterTurn(r.board);
      } else {
        store = r.board[P1_STORE];
      }
      if (store > bestStore) bestStore = store;
    }
    maxP2Cache.set(key, bestStore);
    return bestStore;
  }

  function evaluateTurn(board, move) {
    var key = boardKey(board) + "|" + move;
    var cached = evalCache.get(key);
    if (cached !== undefined) return cached;

    var r = makeMove(board, 0, move);
    var nb = r.board;

    // 1. Absolute clinch: bot already has a majority share.
    if (nb[P0_STORE] > 24) {
      evalCache.set(key, 99999);
      return 99999;
    }

    // 2. Extra-turn chain — recurse on bot's next move.
    if (!r.gameOver && r.nextPlayer === 0) {
      var legal = legalMoves(nb, 0);
      var bestChain = -Infinity;
      for (var i = 0; i < legal.length; i++) {
        var v = evaluateTurn(nb, legal[i]);
        if (v > bestChain) bestChain = v;
      }
      evalCache.set(key, bestChain);
      return bestChain;
    }

    // 3. Turn passes to user. What's the best they can do next turn?
    var p2FutureStore = maxP2StoreAfterTurn(nb);
    if (p2FutureStore > 24) {
      evalCache.set(key, -99999);
      return -99999;
    }

    // 4. Linear positional features.
    var p1Pits = [nb[0], nb[1], nb[2], nb[3], nb[4], nb[5]];
    var activePits = 0;
    var highestTower = 0;
    for (var p = 0; p < 6; p++) {
      if (p1Pits[p] > 0) activePits++;
      if (p1Pits[p] > highestTower) highestTower = p1Pits[p];
    }
    var leftSide = p1Pits[0] + p1Pits[1] + p1Pits[2];
    var rightSide = p1Pits[3] + p1Pits[4] + p1Pits[5];
    var leftBias = leftSide - rightSide;
    var p2Side = nb[7] + nb[8] + nb[9] + nb[10] + nb[11] + nb[12];
    var totalStones = leftSide + rightSide + p2Side;
    var worstCaseDelta = nb[P0_STORE] - (p2FutureStore + p2Side);

    // Score = signed point differential (×100) + positional bonuses.
    var score = (nb[P0_STORE] - p2FutureStore) * 100;
    score += activePits * 20;
    score += leftBias * 10;
    score -= highestTower * 5;
    if (totalStones <= 26) score += worstCaseDelta * 15;

    evalCache.set(key, score);
    return score;
  }

  function p1Strategy(board) {
    // 1. Opening book.
    var opening = getOpeningMove(board);
    if (opening !== null) return opening;

    // 2. Tablebase intercept — skipped (commented out in the Python source).

    // 3. Heuristic evaluator — pick the highest-scoring legal move.
    var moves = legalMoves(board, 0);
    var bestMove = null;
    var bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var s = evaluateTurn(board, moves[i]);
      if (s > bestScore) { bestScore = s; bestMove = moves[i]; }
    }
    return bestMove;
  }

  // ------------------------------------------------------------------
  // Play loop — port of app.py _play_until_user_or_end + endpoints
  // ------------------------------------------------------------------
  function resultStr(board) {
    var p0 = board[P0_STORE], p1 = board[P1_STORE];
    if (p0 > p1) return "P1"; // bot (called P1 in the UI)
    if (p1 > p0) return "P2"; // user
    return "DRAW";
  }

  function playUntilUserOrEnd(board, player) {
    var log = [];
    var b = board.slice();
    var p = player;
    while (true) {
      if (p === null) {
        return { board: b, toMove: null, gameOver: true, log: log };
      }
      if (p === 1) {
        return { board: b, toMove: 1, gameOver: false, log: log };
      }
      // p === 0 — bot's turn.
      var legal = legalMoves(b, 0);
      if (legal.length === 0) {
        return { board: b, toMove: null, gameOver: true, log: log };
      }
      var move = p1Strategy(b);
      if (move === null || legal.indexOf(move) === -1) move = legal[0];
      var r = makeMove(b, 0, move);
      log.push({ player: 0, move: move, captured: r.captured });
      b = r.board;
      p = r.gameOver ? null : r.nextPlayer;
    }
  }

  function startPlay() {
    var b = initialBoard();
    var r = playUntilUserOrEnd(b, 0);
    return {
      board: r.board,
      toMove: r.toMove,
      gameOver: r.gameOver,
      log: r.log,
      result: r.gameOver ? resultStr(r.board) : null,
    };
  }

  function userMove(req) {
    var board = req.board.slice();
    var move = req.move | 0;

    var legal = legalMoves(board, 1);
    if (legal.indexOf(move) === -1) {
      return {
        __status: 400,
        error: "Move " + move + " not legal. Legal: [" + legal.join(", ") + "]",
        legal: legal,
      };
    }

    var log = [];
    var first = makeMove(board, 1, move);
    log.push({ player: 1, move: move, captured: first.captured });

    if (first.gameOver) {
      return {
        board: first.board,
        toMove: null,
        gameOver: true,
        log: log,
        result: resultStr(first.board),
      };
    }
    if (first.nextPlayer === 1) {
      // User earned an extra turn.
      return {
        board: first.board,
        toMove: 1,
        gameOver: false,
        log: log,
        result: null,
      };
    }
    // Bot to move now.
    var r = playUntilUserOrEnd(first.board, 0);
    return {
      board: r.board,
      toMove: r.toMove,
      gameOver: r.gameOver,
      log: log.concat(r.log),
      result: r.gameOver ? resultStr(r.board) : null,
    };
  }

  // ------------------------------------------------------------------
  // Public surface
  // ------------------------------------------------------------------
  global.KalahEngine = {
    expandNode: expandNode,
    startPlay: startPlay,
    userMove: userMove,
    // exposed for debugging from devtools
    _internals: {
      makeMove: makeMove,
      legalMoves: legalMoves,
      alphabeta: alphabeta,
      p1Strategy: p1Strategy,
      ttSize: function () { return _tt.size; },
    },
  };
})(window);
