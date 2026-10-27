#!/usr/bin/env node
import assert from 'node:assert/strict';

import { loadAliases, loadMovies, ocrEvidence } from './lib/poster-audit.mjs';

const movies = loadMovies();
const aliases = loadAliases();
const byId = new Map(movies.map((movie) => [movie.id, movie]));

function check(id, text, { lines = [], expectConflict = false } = {}) {
  const movie = byId.get(id);
  assert.ok(movie, `missing movie ${id}`);
  const evidence = ocrEvidence({ id, year: movie.year }, movie, aliases, {
    available: true,
    ok: true,
    text,
    lines,
  });
  if (expectConflict) {
    assert.ok(evidence.conflicts.length, `${id} should report a visual conflict: ${text}`);
  } else {
    assert.equal(evidence.conflicts.length, 0, `${id} should not report a conflict: ${truthyDetails(evidence)}`);
  }
  return evidence;
}

function truthyDetails(evidence) {
  return evidence.conflicts.join('; ');
}

const lateBlossomOk = check('20261014', '我爱你\nLATE BLOSSOM\n2011');
assert.equal(lateBlossomOk.titleHit, '我爱你');
assert.equal(lateBlossomOk.yearMatch, true);

check('20261014', '我想爱你到白头\n领衔主演 倪大红 惠英红 梁家辉 叶童\n韩延导演作品', {
  expectConflict: true,
});
check('20261014', '我爱你\n2023年6月21日全国上映', {
  lines: [
    { text: '我爱你', confidence: 0.9, height: 0.08 },
    { text: '2023年6月21日全国上映', confidence: 0.9, height: 0.06 },
  ],
  expectConflict: true,
});

check('20261013-book-of-fish', '原名\n《慕伶，一吗，伟明》\n1月22日全国上映', {
  expectConflict: true,
});

const wayHomeOk = check('20261012-the-way-home', '有你真好\nThe Way Home');
assert.ok(['有你真好', 'The Way Home'].includes(wayHomeOk.titleHit));

const unreadable = check('20261026-millennium', 'MILLENNIUM ACTRESS\n2001', {
  lines: [{ text: 'MILLENNIUM ACTRESS', confidence: 0.9, height: 0.08 }],
});
assert.equal(unreadable.conflicts.length, 0);

console.log('Poster QA regression checks passed: wrong remake, wrong director, wrong original title, valid aliases.');
