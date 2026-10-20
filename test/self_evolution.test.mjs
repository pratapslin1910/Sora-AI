import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvolutionStore } from '../src/server/selfEvolution/evolutionStore.js';
import { SelfEvolutionService } from '../src/server/selfEvolution/selfEvolutionService.js';

function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-evolution-'));
  const file = path.join(dir, 'history.json');
  const service = new SelfEvolutionService({ store: new EvolutionStore(file), ...options });
  return {
    service,
    file,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('Self-Evolution Core — Phase 1', () => {
  it('persists proposals and prepared artifacts across service instances', () => {
    const f = fixture();
    try {
      const proposal = f.service.propose({
        title: 'Improve parser',
        rationale: 'Handle an additional valid input shape.',
        artifact: 'diff --git a/example b/example',
      });
      assert.equal(proposal.status, 'proposed');
      const prepared = f.service.prepare(proposal.id);
      assert.equal(prepared.status, 'prepared');
      assert.match(prepared.artifact.sha256, /^[a-f0-9]{64}$/);

      const restarted = new SelfEvolutionService({ store: new EvolutionStore(f.file) });
      assert.equal(restarted.get(proposal.id).status, 'prepared');
      assert.equal(restarted.get(proposal.id).artifact.content, 'diff --git a/example b/example');
    } finally {
      f.cleanup();
    }
  });

  it('requires explicit approval before apply and explicit APPLY confirmation', async () => {
    let applied = 0;
    const f = fixture({ applyArtifact: async () => { applied += 1; return { ok: true }; } });
    try {
      const p = f.service.propose({ title: 'Patch', rationale: 'Reason', artifact: 'patch content' });
      f.service.prepare(p.id);
      await assert.rejects(() => f.service.apply(p.id, { confirmation: 'APPLY' }), /Invalid transition/);
      assert.equal(applied, 0);

      await assert.rejects(() => f.service.approve(p.id, { approvedBy: 'user', confirmation: 'yes' }), /APPROVE/);
      f.service.approve(p.id, { approvedBy: 'user', confirmation: 'APPROVE' });
      await assert.rejects(() => f.service.apply(p.id, { confirmation: 'yes' }), /APPLY/);
      assert.equal(applied, 0);

      const result = await f.service.apply(p.id, { confirmation: 'APPLY' });
      assert.equal(result.status, 'applied');
      assert.equal(applied, 1);
    } finally {
      f.cleanup();
    }
  });

  it('does not apply anything when no host apply handler is configured', async () => {
    const f = fixture();
    try {
      const p = f.service.propose({ title: 'Patch', rationale: 'Reason', artifact: 'patch content' });
      f.service.prepare(p.id);
      f.service.approve(p.id, { approvedBy: 'user', confirmation: 'APPROVE' });
      await assert.rejects(() => f.service.apply(p.id, { confirmation: 'APPLY' }), /No isolated apply handler/);
      assert.equal(f.service.get(p.id).status, 'approved');
    } finally {
      f.cleanup();
    }
  });

  it('supports cancel before application and rejects later transitions', () => {
    const f = fixture();
    try {
      const p = f.service.propose({ title: 'Patch', rationale: 'Reason', artifact: 'patch content' });
      assert.equal(f.service.cancel(p.id).status, 'cancelled');
      assert.throws(() => f.service.prepare(p.id), /Invalid transition/);
    } finally {
      f.cleanup();
    }
  });

  it('requires explicit rollback and invokes only the configured rollback handler', async () => {
    let rolledBack = 0;
    const f = fixture({
      applyArtifact: async () => ({ ok: true }),
      verifyArtifact: async () => ({ passed: true, checks: ['unit-tests'] }),
      rollbackArtifact: async () => { rolledBack += 1; return { restored: true }; },
    });
    try {
      const p = f.service.propose({ title: 'Patch', rationale: 'Reason', artifact: 'patch content' });
      f.service.prepare(p.id);
      f.service.approve(p.id, { approvedBy: 'user', confirmation: 'APPROVE' });
      await f.service.apply(p.id, { confirmation: 'APPLY' });
      assert.equal((await f.service.verify(p.id)).status, 'verified');
      await assert.rejects(() => f.service.rollback(p.id, { confirmation: 'yes' }), /ROLLBACK/);
      assert.equal(rolledBack, 0);
      assert.equal((await f.service.rollback(p.id, { confirmation: 'ROLLBACK' })).status, 'rolled_back');
      assert.equal(rolledBack, 1);
    } finally {
      f.cleanup();
    }
  });
});
