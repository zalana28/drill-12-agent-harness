'use strict';

const fs = require('fs');

// Append-only JSONL transcript. Every entry is { seq, kind, ... } with seq
// starting at 1 and increasing by exactly 1 per entry.

class Transcript {
  constructor() {
    this.entries = [];
  }

  append(kind, data = {}) {
    // kind is always the entry type; data fields can never clobber it.
    const entry = { ...data, seq: this.entries.length + 1, kind };
    this.entries.push(entry);
    return entry;
  }

  toJSONL() {
    return this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : '');
  }

  async save(filePath) {
    await fs.promises.writeFile(filePath, this.toJSONL(), 'utf8');
  }

  static parse(jsonl) {
    return jsonl.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }
}

module.exports = { Transcript };
