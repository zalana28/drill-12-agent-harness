'use strict';

// Hand-written typed argument validator. Fail-closed: anything that does not
// match the schema is rejected before the tool handler runs.

class ValidationError extends Error {
  constructor(field, reason) {
    super(`invalid argument "${field}": ${reason}`);
    this.name = 'ValidationError';
    this.code = 'VALIDATION';
    this.field = field;
  }
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkType(value, type, field) {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') throw new ValidationError(field, `expected string, got ${typeof value}`);
      return;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) throw new ValidationError(field, 'expected number');
      return;
    case 'integer':
      if (!Number.isInteger(value)) throw new ValidationError(field, `expected integer, got ${JSON.stringify(value)}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') throw new ValidationError(field, `expected boolean, got ${typeof value}`);
      return;
    case 'array':
      if (!Array.isArray(value)) throw new ValidationError(field, 'expected array');
      return;
    case 'object':
      if (!isPlainObject(value)) throw new ValidationError(field, 'expected object');
      return;
    default:
      throw new Error(`unknown schema type: ${type}`);
  }
}

// schema: { argName: { type, required } }
// Returns a copy containing only declared keys. Throws ValidationError on:
// missing required arg, wrong type, unknown key, non-object args.
function validateArgs(schema, args) {
  if (!isPlainObject(args)) throw new ValidationError('(args)', 'arguments must be an object');
  const out = {};
  for (const [key, spec] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(args, key);
    if (!present || args[key] === undefined) {
      if (spec.required) throw new ValidationError(key, 'missing required argument');
      continue;
    }
    checkType(args[key], spec.type, key);
    out[key] = args[key];
  }
  for (const key of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      throw new ValidationError(key, 'unknown argument');
    }
  }
  return out;
}

module.exports = { ValidationError, validateArgs, isPlainObject };
