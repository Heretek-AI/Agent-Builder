// scripts/spike-verify.js
const assert = require('assert');

function normalizeMcpId(str) {
  return String(str).trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function evaluateV2Permission(permissions, action, resource = '*') {
  let decision = 'allow';
  for (const rule of permissions) {
    const actionRegex = new RegExp('^' + rule.action.replace(/\*/g, '.*') + '$');
    const resourceRegex = new RegExp('^' + rule.resource.replace(/\*/g, '.*') + '$');
    if (actionRegex.test(action) && resourceRegex.test(resource)) {
      decision = rule.effect;
    }
  }
  return decision;
}

const rules = [
  { action: 'skill', resource: '*', effect: 'deny' },
  { action: 'skill', resource: 'rust-secure-coding', effect: 'allow' },
  { action: `${normalizeMcpId('postgres-prod')}_*`, resource: '*', effect: 'deny' },
  { action: `${normalizeMcpId('postgres-prod')}_${normalizeMcpId('query')}`, resource: '*', effect: 'allow' }
];

assert.strictEqual(evaluateV2Permission(rules, 'skill', 'rust-secure-coding'), 'allow');
assert.strictEqual(evaluateV2Permission(rules, 'skill', 'other-skill'), 'deny');
assert.strictEqual(evaluateV2Permission(rules, 'postgres_prod_query', '*'), 'allow');
assert.strictEqual(evaluateV2Permission(rules, 'postgres_prod_drop', '*'), 'deny');
console.log('SPIKE_VERIFY_OK');
