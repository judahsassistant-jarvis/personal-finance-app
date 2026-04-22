/**
 * Firestore security rules unit tests.
 *
 * Runs against the Firestore emulator (FIRESTORE_EMULATOR_HOST). For each
 * user-scoped collection, verifies:
 *   - authed owner can read + create + update + delete their own docs
 *   - a different authed user CANNOT read / mutate someone else's docs
 *   - an unauthenticated client is denied
 *   - writes that set user_id to someone else's UID are denied
 *
 * Also covers users/{uid} self-only access, and system/* read-only.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');
const PROJECT_ID = 'pfa-rules-test';
const ALICE = 'alice-uid';
const BOB = 'bob-uid';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

after(async () => {
  await env.cleanup();
});

function aliceDb() {
  return env.authenticatedContext(ALICE).firestore();
}
function bobDb() {
  return env.authenticatedContext(BOB).firestore();
}
function anonDb() {
  return env.unauthenticatedContext().firestore();
}

async function seed(collection, docId, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, docId), data);
  });
}

// Collections that follow the standard user_id ownership pattern.
const USER_SCOPED = [
  'accounts',
  'debts',
  'card_buckets',
  'transactions',
  'balance_snapshots',
  'recurring_bills',
  'monthly_budgets',
  'debt_config',
];

describe('users/{uid}', () => {
  it('owner can create own profile', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'users', ALICE), { email: 'a@a.com' })
    );
  });
  it('owner can read and update own profile', async () => {
    await seed('users', ALICE, { email: 'a@a.com' });
    await assertSucceeds(getDoc(doc(aliceDb(), 'users', ALICE)));
    await assertSucceeds(updateDoc(doc(aliceDb(), 'users', ALICE), { display_name: 'Alice' }));
  });
  it('other user cannot read or write someone else profile', async () => {
    await seed('users', ALICE, { email: 'a@a.com' });
    await assertFails(getDoc(doc(bobDb(), 'users', ALICE)));
    await assertFails(updateDoc(doc(bobDb(), 'users', ALICE), { display_name: 'hacker' }));
  });
  it('unauthenticated cannot read or write', async () => {
    await seed('users', ALICE, { email: 'a@a.com' });
    await assertFails(getDoc(doc(anonDb(), 'users', ALICE)));
    await assertFails(setDoc(doc(anonDb(), 'users', 'anon'), { email: 'x@x.com' }));
  });
  it('delete is forbidden even for owner', async () => {
    await seed('users', ALICE, { email: 'a@a.com' });
    await assertFails(deleteDoc(doc(aliceDb(), 'users', ALICE)));
  });
});

for (const col of USER_SCOPED) {
  describe(`${col}/{id}`, () => {
    it('owner can create with own user_id', async () => {
      await assertSucceeds(
        setDoc(doc(aliceDb(), col, 'doc-a'), { user_id: ALICE, name: 'x' })
      );
    });
    it('owner cannot create with someone else user_id', async () => {
      await assertFails(
        setDoc(doc(aliceDb(), col, 'doc-b'), { user_id: BOB, name: 'x' })
      );
    });
    it('owner can read + update + delete own doc', async () => {
      await seed(col, 'owned-by-alice', { user_id: ALICE, name: 'x' });
      await assertSucceeds(getDoc(doc(aliceDb(), col, 'owned-by-alice')));
      await assertSucceeds(updateDoc(doc(aliceDb(), col, 'owned-by-alice'), { name: 'y' }));
      await assertSucceeds(deleteDoc(doc(aliceDb(), col, 'owned-by-alice')));
    });
    it('owner cannot change user_id on update (no doc give-away)', async () => {
      await seed(col, 'owned-by-alice-giveaway', { user_id: ALICE, name: 'x' });
      await assertFails(
        updateDoc(doc(aliceDb(), col, 'owned-by-alice-giveaway'), { user_id: BOB })
      );
    });
    it('other authed user cannot read or write', async () => {
      await seed(col, 'owned-by-alice-2', { user_id: ALICE, name: 'x' });
      await assertFails(getDoc(doc(bobDb(), col, 'owned-by-alice-2')));
      await assertFails(updateDoc(doc(bobDb(), col, 'owned-by-alice-2'), { name: 'pwned' }));
      await assertFails(deleteDoc(doc(bobDb(), col, 'owned-by-alice-2')));
    });
    it('unauthenticated is denied', async () => {
      await seed(col, 'owned-by-alice-3', { user_id: ALICE, name: 'x' });
      await assertFails(getDoc(doc(anonDb(), col, 'owned-by-alice-3')));
      await assertFails(setDoc(doc(anonDb(), col, 'anon-doc'), { user_id: 'anon', name: 'x' }));
    });
  });
}

describe('forecast_snapshots/{id}', () => {
  it('owner can create + read + delete; update allowed (cache refresh)', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'forecast_snapshots', 's1'), { user_id: ALICE, type: 'debt', payload: {} })
    );
    await assertSucceeds(getDoc(doc(aliceDb(), 'forecast_snapshots', 's1')));
    await assertSucceeds(updateDoc(doc(aliceDb(), 'forecast_snapshots', 's1'), { payload: { v: 2 } }));
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'forecast_snapshots', 's1')));
  });
  it('other user cannot read', async () => {
    await seed('forecast_snapshots', 's2', { user_id: ALICE, type: 'debt', payload: {} });
    await assertFails(getDoc(doc(bobDb(), 'forecast_snapshots', 's2')));
  });
});

describe('audit_log/{id}', () => {
  it('owner can create + read; cannot update or delete', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'audit_log', 'a1'), {
        user_id: ALICE, entity_type: 'debt', entity_id: 'd1', action: 'create',
      })
    );
    await assertSucceeds(getDoc(doc(aliceDb(), 'audit_log', 'a1')));
    await assertFails(updateDoc(doc(aliceDb(), 'audit_log', 'a1'), { action: 'update' }));
    await assertFails(deleteDoc(doc(aliceDb(), 'audit_log', 'a1')));
  });
});

describe('system/{doc}', () => {
  it('authed user can read, not write', async () => {
    await seed('system', 'bank_holidays', { england_and_wales: [] });
    await assertSucceeds(getDoc(doc(aliceDb(), 'system', 'bank_holidays')));
    await assertFails(setDoc(doc(aliceDb(), 'system', 'bank_holidays'), { england_and_wales: ['hacked'] }));
  });
  it('unauthenticated cannot read', async () => {
    await seed('system', 'bank_holidays', { england_and_wales: [] });
    await assertFails(getDoc(doc(anonDb(), 'system', 'bank_holidays')));
  });
});

describe('unknown collection', () => {
  it('denies reads and writes regardless of auth state', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'secrets', 'x'), { user_id: ALICE, v: 1 }));
    await seed('secrets', 'y', { user_id: ALICE });
    await assertFails(getDoc(doc(aliceDb(), 'secrets', 'y')));
  });
});
