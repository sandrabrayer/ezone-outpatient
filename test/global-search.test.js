'use strict';

// Unit tests for public/global-search.js — the pure matcher behind the
// «חיפוש מטופל» box on «היום שלי». No DOM, no server.
const test = require('node:test');
const assert = require('node:assert/strict');
const GlobalSearch = require('../public/global-search.js');

const CLIENTS = [
  { id: 'c1', name: 'דנה כהן', phone: '052-378-7911', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', pricePerSession: 2000, paymentStatus: 'unpaid' },
  { id: 'c2', name: 'יוסי לֵוִי', phone: '0541112222', status: 'פעיל', serviceType: 'קבוצתי', location: 'עפרוני' },
  { id: 'c3', name: 'רונית כהן', phone: '0509998888', status: 'סיים טיפול', serviceType: 'פרטני', location: 'אשר' },
  { id: 'c4', name: 'אבי מזרחי', phone: '', status: 'לא פעיל', serviceType: '', location: '' }
];
const LEADS = [
  { id: 'l1', name: 'מיכל כהן', phone: '+972 50 123 4567', stage: 'new', serviceType: 'פרטני', location: 'רמות' },
  { id: 'l2', name: 'ליד לא רלוונטי', phone: '0521111111', stage: 'not_relevant' },
  { id: 'l3', name: 'ליד שהופעל', phone: '0522222222', stage: 'active' }
];
const DATA = { clients: CLIENTS, leads: LEADS };

test('a blank query matches nothing (the dropdown is empty at rest)', () => {
  for (const q of ['', '   ', null, undefined]) {
    assert.deepEqual(GlobalSearch.search(q, DATA), [], JSON.stringify(q));
    assert.equal(GlobalSearch.matches('דנה כהן', '0523787911', GlobalSearch.normalizeQuery(q)), false);
  }
});

test('partial name match anywhere, case-insensitive', () => {
  assert.deepEqual(GlobalSearch.search('כהן', DATA).map((r) => r.id), ['c1', 'c3', 'l1']);
  assert.deepEqual(GlobalSearch.search('נה כ', DATA).map((r) => r.id), ['c1']);
  assert.equal(GlobalSearch.matches('Dana Cohen', '', GlobalSearch.normalizeQuery('dana')), true);
  assert.equal(GlobalSearch.matches('Dana Cohen', '', GlobalSearch.normalizeQuery('COHEN')), true);
});

test('niqqud is ignored on both sides', () => {
  assert.deepEqual(GlobalSearch.search('לוי', DATA).map((r) => r.id), ['c2']);
  assert.equal(GlobalSearch.matches('יוסי לוי', '', GlobalSearch.normalizeQuery('לֵוִי')), true);
});

test('phone matches digits-only, however the query or the row is punctuated', () => {
  for (const q of ['052-378-7911', '0523787911', '3787911', '052 378 7911', '(052) 3787911']) {
    assert.deepEqual(GlobalSearch.search(q, DATA).map((r) => r.id), ['c1'], q);
  }
  // an international row matched by its local digits
  assert.deepEqual(GlobalSearch.search('501234567', DATA).map((r) => r.id), ['l1']);
  // a client with no phone is never matched by a phone query
  assert.deepEqual(GlobalSearch.search('0000000', DATA), []);
});

test('only OPEN leads are offered — not_relevant and active are excluded', () => {
  assert.deepEqual(GlobalSearch.search('ליד', DATA), []);
  assert.deepEqual(GlobalSearch.search('מיכל', DATA).map((r) => ({ id: r.id, tab: r.tab, statusLabel: r.statusLabel })),
    [{ id: 'l1', tab: 'leads', statusLabel: 'ליד' }]);
});

test('status hint and target tab per row', () => {
  const byId = Object.fromEntries(GlobalSearch.search('0', { clients: CLIENTS, leads: [], limit: 50 }).map((r) => [r.id, r]));
  assert.deepEqual(
    GlobalSearch.search('כהן', DATA).map((r) => [r.id, r.statusKind, r.statusLabel, r.tab]),
    [['c1', 'active', 'פעיל', 'clients'], ['c3', 'inactive', 'לא פעיל', 'inactive'], ['l1', 'lead', 'ליד', 'leads']]
  );
  assert.equal(byId.c2.sub, 'קבוצתי · עפרוני');
  // both inactive kinds collapse to one hint and one tab
  const off = GlobalSearch.search('אבי', DATA)[0];
  assert.deepEqual([off.statusKind, off.statusLabel, off.tab], ['inactive', 'לא פעיל', 'inactive']);
});

test('no financial field ever reaches a result row', () => {
  const rows = GlobalSearch.search('כהן', DATA);
  assert.ok(rows.length);
  const allowed = ['kind', 'id', 'name', 'phone', 'sub', 'statusKind', 'statusLabel', 'tab'];
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), allowed.slice().sort(), JSON.stringify(r));
    assert.equal(/2000|unpaid|price|debt|amount|₪/i.test(JSON.stringify(r)), false, JSON.stringify(r));
  }
});

test('ranking: active clients, then inactive, then leads; alphabetical inside a group', () => {
  const rows = GlobalSearch.search('0', {
    clients: [CLIENTS[2], CLIENTS[1], CLIENTS[0]], leads: [LEADS[0]], limit: 50
  });
  assert.deepEqual(rows.map((r) => r.statusKind), ['active', 'active', 'inactive', 'lead']);
  // the DISPLAY name keeps its niqqud; only the sort key is folded
  assert.deepEqual(rows.filter((r) => r.statusKind === 'active').map((r) => r.name), ['דנה כהן', 'יוסי לֵוִי']);
});

test('result count is capped (8 by default) and the cap is overridable', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, name: 'מטופל ' + i, phone: '050000' + String(i).padStart(4, '0'), status: 'פעיל' }));
  assert.equal(GlobalSearch.MAX_RESULTS, 8);
  assert.equal(GlobalSearch.search('מטופל', { clients: many }).length, 8);
  assert.equal(GlobalSearch.search('מטופל', { clients: many, limit: 3 }).length, 3);
  assert.equal(GlobalSearch.search('מטופל', { clients: many, limit: 50 }).length, 30);
});

test('missing / malformed input never throws', () => {
  assert.deepEqual(GlobalSearch.search('כהן', undefined), []);
  assert.deepEqual(GlobalSearch.search('כהן', { clients: null, leads: 'nope' }), []);
  assert.deepEqual(GlobalSearch.search('x', { clients: [null, undefined, {}] }), []);
  assert.equal(GlobalSearch.foldName(null), '');
  assert.equal(GlobalSearch.digits(null), '');
});
