import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Durable JSON store for self-evolution proposals.
 * Writes are atomic so an interrupted process cannot leave half-written JSON.
 */
export class EvolutionStore {
  constructor(filePath = path.resolve(process.cwd(), 'data/self_evolution.json')) {
    this.filePath = filePath;
  }

  readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.proposals)) {
        throw new Error('Self-evolution store has an unsupported or invalid schema.');
      }
      return parsed.proposals;
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  get(id) {
    return this.readAll().find((item) => item.id === id) ?? null;
  }

  save(proposal) {
    const proposals = this.readAll();
    const index = proposals.findIndex((item) => item.id === proposal.id);
    if (index === -1) proposals.push(proposal);
    else proposals[index] = proposal;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        proposals,
      }, null, 2), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporaryPath, this.filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
    return proposal;
  }

  list() {
    return this.readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
