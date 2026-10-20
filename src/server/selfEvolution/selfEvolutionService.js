import { createHash, randomUUID } from 'node:crypto';
import { EvolutionStore } from './evolutionStore.js';

const TERMINAL_STATES = new Set(['verified', 'failed', 'cancelled', 'rolled_back']);

function now() {
  return new Date().toISOString();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

/**
 * Lifecycle coordinator. It never executes generated code while proposing or
 * preparing. Applying and rollback require explicitly injected host handlers.
 */
export class SelfEvolutionService {
  constructor({ store = new EvolutionStore(), applyArtifact = null, verifyArtifact = null, rollbackArtifact = null } = {}) {
    this.store = store;
    this.applyArtifact = applyArtifact;
    this.verifyArtifact = verifyArtifact;
    this.rollbackArtifact = rollbackArtifact;
  }

  list() {
    return this.store.list();
  }

  get(id) {
    return this.store.get(requireText(id, 'Proposal ID'));
  }

  propose({ title, rationale, artifact, createdBy = 'user' }) {
    title = requireText(title, 'Title');
    rationale = requireText(rationale, 'Rationale');
    if (typeof artifact !== 'string' || !artifact.trim()) {
      throw new TypeError('Artifact must be a non-empty string.');
    }
    const timestamp = now();
    return this.store.save({
      id: randomUUID(),
      title,
      rationale,
      createdBy: requireText(createdBy, 'Created by'),
      status: 'proposed',
      createdAt: timestamp,
      updatedAt: timestamp,
      artifact: null,
      events: [{ type: 'proposed', at: timestamp }],
      _draftArtifact: artifact,
    });
  }

  prepare(id) {
    const proposal = this.#requireState(id, ['proposed']);
    // Preparing stores a content-addressed artifact only; it does not execute it.
    const content = proposal._draftArtifact;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Proposal draft artifact is missing; create a new proposal.');
    }
    proposal.artifact = { id: randomUUID(), sha256: digest(content), content, preparedAt: now() };
    proposal.status = 'prepared';
    delete proposal._draftArtifact;
    this.#event(proposal, 'prepared', { artifactId: proposal.artifact.id, sha256: proposal.artifact.sha256 });
    return this.store.save(proposal);
  }

  approve(id, { approvedBy, confirmation } = {}) {
    const proposal = this.#requireState(id, ['prepared']);
    if (confirmation !== 'APPROVE') throw new Error('Explicit confirmation "APPROVE" is required.');
    proposal.approvedBy = requireText(approvedBy, 'Approved by');
    proposal.approvedAt = now();
    proposal.status = 'approved';
    this.#event(proposal, 'approved', { approvedBy: proposal.approvedBy });
    return this.store.save(proposal);
  }

  async apply(id, { confirmation } = {}) {
    const proposal = this.#requireState(id, ['approved']);
    if (confirmation !== 'APPLY') throw new Error('Explicit confirmation "APPLY" is required.');
    if (typeof this.applyArtifact !== 'function') {
      throw new Error('No isolated apply handler is configured; no changes were applied.');
    }
    if (!proposal.artifact || digest(proposal.artifact.content) !== proposal.artifact.sha256) {
      throw new Error('Artifact integrity check failed; refusing to apply.');
    }
    try {
      const result = await this.applyArtifact({ proposal: structuredClone(proposal), artifact: proposal.artifact });
      proposal.status = 'applied';
      proposal.applyResult = result ?? null;
      proposal.appliedAt = now();
      this.#event(proposal, 'applied');
      return this.store.save(proposal);
    } catch (error) {
      proposal.status = 'failed';
      proposal.failure = error instanceof Error ? error.message : String(error);
      this.#event(proposal, 'apply_failed', { message: proposal.failure });
      this.store.save(proposal);
      throw error;
    }
  }

  async verify(id) {
    const proposal = this.#requireState(id, ['applied']);
    if (typeof this.verifyArtifact !== 'function') {
      throw new Error('No verification handler is configured.');
    }
    const result = await this.verifyArtifact({ proposal: structuredClone(proposal), artifact: proposal.artifact });
    proposal.verification = result ?? null;
    proposal.status = result?.passed === true ? 'verified' : 'failed';
    proposal.verifiedAt = now();
    this.#event(proposal, proposal.status, { verification: proposal.verification });
    return this.store.save(proposal);
  }

  cancel(id) {
    const proposal = this.#requireState(id, ['proposed', 'prepared', 'approved']);
    proposal.status = 'cancelled';
    proposal.cancelledAt = now();
    delete proposal._draftArtifact;
    this.#event(proposal, 'cancelled');
    return this.store.save(proposal);
  }

  async rollback(id, { confirmation } = {}) {
    const proposal = this.#requireState(id, ['applied', 'verified', 'failed']);
    if (confirmation !== 'ROLLBACK') throw new Error('Explicit confirmation "ROLLBACK" is required.');
    if (!proposal.appliedAt) throw new Error('This proposal has no recorded applied state to roll back.');
    if (typeof this.rollbackArtifact !== 'function') {
      throw new Error('No rollback handler is configured; no rollback was attempted.');
    }
    const result = await this.rollbackArtifact({ proposal: structuredClone(proposal), artifact: proposal.artifact });
    proposal.status = 'rolled_back';
    proposal.rollbackResult = result ?? null;
    proposal.rolledBackAt = now();
    this.#event(proposal, 'rolled_back');
    return this.store.save(proposal);
  }

  #requireState(id, allowed) {
    const proposal = this.store.get(requireText(id, 'Proposal ID'));
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    if (!allowed.includes(proposal.status) || TERMINAL_STATES.has(proposal.status)) {
      throw new Error(`Invalid transition from "${proposal.status}" for proposal ${id}.`);
    }
    return proposal;
  }

  #event(proposal, type, details = {}) {
    proposal.updatedAt = now();
    proposal.events.push({ type, at: proposal.updatedAt, ...details });
  }
}
