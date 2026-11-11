'use strict';
// Export seed data as JSON (platform-neutral seed for other implementations). Usage: npm run seed:export
const fs = require('node:fs'); const path = require('node:path');
const { q } = require('../db');
const { seedAll } = require('./index');
if (q.count('users') === 0) seedAll({ reset: true });
const out = path.join(__dirname, '..', '..', 'seed');
const tables = { countries: 'countries', companies: 'companies', users: "users", buyers: 'buyers', programs: 'programs', events: 'events', market_content: 'market_content', regulations: 'regulations', faqs: 'faqs', consultations: 'consultations', match_requests: 'match_requests', research_requests: 'research_requests', eval_cases: 'eval_cases', trade_stats: 'trade_stats', documents: 'documents', collections: 'collections' };
for (const [name, t] of Object.entries(tables)) {
  let rows = q.all(`SELECT * FROM ${t}`);
  if (t === 'users') rows = rows.map(({ pw_hash, ...r }) => r); // never export credentials
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(rows, null, 1));
}
console.log('exported', Object.keys(tables).length, 'seed files →', out);
