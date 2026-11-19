'use strict';

// Tool registry: a plain store. Validation and execution live in loop.js so
// that a malformed call is rejected before any retry or handler runs.

class Registry {
  constructor() {
    this.tools = new Map();
  }

  register(name, def) {
    if (typeof name !== 'string' || !name) throw new Error('tool name must be a non-empty string');
    if (!def || typeof def.handler !== 'function') throw new Error(`tool "${name}": handler must be a function`);
    if (!def.args || typeof def.args !== 'object') throw new Error(`tool "${name}": args schema is required`);
    if (this.tools.has(name)) throw new Error(`tool "${name}" is already registered`);
    this.tools.set(name, { name, description: def.description || '', args: def.args, handler: def.handler });
  }

  get(name) {
    return this.tools.get(name);
  }

  has(name) {
    return this.tools.has(name);
  }

  names() {
    return [...this.tools.keys()];
  }
}

module.exports = { Registry };
