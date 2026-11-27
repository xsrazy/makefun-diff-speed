// Faster drop-in for makefun-diff 1.0.0: the same patch, byte for byte, faster.
//
// Strategy: intern every line to a small integer id (one shared table for both
// texts, so equal lines share an id), trim the common prefix/suffix, then run
// Myers's greedy search exactly as makefun-diff 1.0.0 states it — deletion
// wins a tie, no edge diagonal is pruned, a snake follows every step — over
// typed arrays, keeping the per-d furthest-x trace in one flat buffer so the
// edit script is recovered by backtracking instead of by carrying a linked
// list of path objects. The patch writer is makefun-diff's own rule, ported
// line for line.
//
// Lines: a text is cut after every "\n" (the only separator; a "\r" is part of
// its line), and a last line with no "\n" is a line too. Two lines are equal
// only when they are the same code units, newline or its absence included: a
// bare last line gets a negative id, so it can never match a "\n"-terminated
// line of the same body.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  return diffPatch(input.old, input.new);
}

/** One text, tokenized: bodies (without "\n"), integer ids, and whether the last line is bare. */
function tokenize(text, idOf) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const n = last + (parts[last] !== '' ? 1 : 0);
  const ids = new Int32Array(n);
  for (let i = 0; i < last; i++) ids[i] = idOf(parts[i]);
  let bare = false;
  if (parts[last] !== '') {
    ids[last] = -(idOf(parts[last]) + 1);
    bare = true;
  }
  return { parts, n, ids, bare };
}

/**
 * The edit runs of the middle (after prefix/suffix trim) of A[ox..ox+N) into
 * B[oy..oy+M): [[kind, count], ...] in order, kind 0 keep / 1 delete / 2 insert.
 * Myers's greedy search, makefun-diff's rule: on diagonal k the furthest point
 * is the deletion's when it reaches as far as the insertion's, a step past
 * either text's end is no candidate, no edge diagonal is pruned, and every
 * step is followed along its run of equal lines as far as it goes.
 *
 * The trace is one flat Int32Array: row d starts at off[d] and holds the
 * furthest old-lines-consumed count per diagonal k = -d..d step 2, at index
 * (k + d) / 2; -1 where the diagonal is dead.
 */
function myers(A, B, ox, oy, N, M) {
  if (N === 0 && M === 0) return [];
  const a = A.subarray(ox, ox + N);
  const b = B.subarray(oy, oy + M);
  let cap = 64;
  let buf = new Int32Array(((cap + 1) * (cap + 2)) >> 1);
  const off = new Int32Array(cap + 1);
  for (let d = 0; d <= cap; d++) off[d] = (d * (d + 1)) >> 1;
  const grow = (need) => {
    while (cap < need) cap *= 2;
    const nb = new Int32Array(((cap + 1) * (cap + 2)) >> 1);
    nb.set(buf);
    buf = nb;
    const curOff = offHolder[0];
    const no = new Int32Array(cap + 1);
    no.set(curOff);
    for (let d = curOff.length; d <= cap; d++) no[d] = (d * (d + 1)) >> 1;
    offHolder[0] = no;
  };
  const offHolder = [off];
  // d = 0: the snake from (0, 0).
  let x = 0;
  const xLim0 = N < M ? N : M;
  while (x < xLim0 && a[x] === b[x]) x++;
  buf[0] = x;
  if (x === N && x === M) return [[KEEP, x]];
  let D = -1;
  outer: for (let d = 1; d <= N + M; d++) {
    if (d > cap) grow(d);
    const offArr = offHolder[0];
    const prevBase = offArr[d - 1];
    const curBase = offArr[d];
    // k = -d: only the insertion from k + 1 can reach it.
    let k = -d;
    let j = 0;
    let insX = buf[prevBase + j];
    let xx;
    let yy;
    if (insX >= 0 && insX - k - 1 < M) {
      xx = insX;
      yy = xx - k;
      const xLim = N < M + k ? N : M + k;
      while (xx < xLim && a[xx] === b[xx - k]) {
        xx++;
      }
      buf[curBase + j] = xx;
      if (xx === N && xx - k === M) {
        D = d;
        break outer;
      }
    } else {
      buf[curBase + j] = -1;
    }
    // Interior diagonals: both neighbours exist.
    for (k = -d + 2, j = 1; k <= d - 2; k += 2, j++) {
      const delX = buf[prevBase + j - 1];
      const insX2 = buf[prevBase + j];
      const delCand = delX >= 0 && delX < N ? delX + 1 : -1;
      const insCand = insX2 >= 0 && insX2 - k - 1 < M ? insX2 : -1;
      if (delCand < 0 && insCand < 0) {
        buf[curBase + j] = -1;
        continue;
      }
      xx = delCand >= insCand ? delCand : insCand;
      const xLim = N < M + k ? N : M + k;
      while (xx < xLim && a[xx] === b[xx - k]) {
        xx++;
      }
      buf[curBase + j] = xx;
      if (xx === N && xx - k === M) {
        D = d;
        break outer;
      }
    }
    // k = d: only the deletion from k - 1 can reach it.
    k = d;
    j = d;
    const delX = buf[prevBase + j - 1];
    if (delX >= 0 && delX < N) {
      xx = delX + 1;
      const xLim = N < M + k ? N : M + k;
      while (xx < xLim && a[xx] === b[xx - k]) {
        xx++;
      }
      buf[curBase + j] = xx;
      if (xx === N && xx - k === M) {
        D = d;
        break outer;
      }
    } else {
      buf[curBase + j] = -1;
    }
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');
  // Backtrack from (N, M): at each d the pre-snake point is the same candidate
  // the forward pass picked (deletion on a tie), the snake is what is left.
  const offArr = offHolder[0];
  const rev = [];
  let d = D;
  let k = N - M;
  x = N;
  let y = M;
  while (d > 0) {
    const prevBase = offArr[d - 1];
    const j = (k + d) >> 1;
    const delX = k > -d ? buf[prevBase + j - 1] : -1;
    const insX = k < d ? buf[prevBase + j] : -1;
    const delCand = delX >= 0 && delX < N ? delX + 1 : -1;
    const insCand = insX >= 0 && insX - k - 1 < M ? insX : -1;
    const isDel = delCand >= insCand;
    const x0 = isDel ? delCand : insCand;
    const y0 = x0 - k;
    const snake = x - x0;
    if (snake > 0) rev.push([KEEP, snake]);
    if (isDel) {
      rev.push([DELETE, 1]);
      x = x0 - 1;
      y = y0;
      k--;
    } else {
      rev.push([INSERT, 1]);
      x = x0;
      y = y0 - 1;
      k++;
    }
    d--;
  }
  if (x > 0) rev.push([KEEP, x]);
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun[0] === r[0]) lastRun[1] += r[1];
    else runs.push([r[0], r[1]]);
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, t, i) {
  const body = t.parts[i];
  return i === t.n - 1 && t.bare ? `${op}${body}\n%\n` : `${op}${body}\n`;
}

/** make.fun's own patch of oldText into newText. */
function diffPatch(oldText, newText) {
  const map = new Map();
  const strs = [];
  const idOf = (s) => {
    let id = map.get(s);
    if (id === undefined) {
      id = strs.length;
      map.set(s, id);
      strs.push(s);
    }
    return id;
  };
  const a = tokenize(oldText, idOf);
  const b = tokenize(newText, idOf);
  const n = a.n;
  const m = b.n;
  const A = a.ids;
  const B = b.ids;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  for (const r of myers(A, B, prefix, prefix, n - prefix - suffix, m - prefix - suffix)) runs.push(r);
  if (suffix > 0) runs.push([KEEP, suffix]);

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    const kind = r[0];
    const count = r[1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * 3 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * 3) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a, at));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a, c.o + i));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b, c.p + i));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a, at));
  }
  return out.join('');
}
