'use strict';

const fs = require('fs');
const path = require('path');

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  RUNTIME: 1,
  USAGE: 2,
  VALIDATION: 3,
  CONNECTIVITY: 4,
});

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode || EXIT_CODES.RUNTIME;
  }
}

function normalizePluginName(input) {
  const slug = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) {
    throw new CliError('Plugin name must contain at least one letter or number.');
  }

  return slug;
}

function validatePluginId(value) {
  const id = typeof value === 'string' ? value : '';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) {
    throw new CliError(
      'Plugin ID must use lowercase letters, numbers, and single hyphens.'
    );
  }
  return id;
}

function readProjectPackage(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new CliError('No package.json found. Run this from a plugin directory.');
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    throw new CliError(`Cannot parse package.json: ${error.message}`);
  }

  return pkg;
}

function safeControlValue(value, field) {
  const result = String(value == null ? '' : value).trim();
  if (!result || /[\r\n]/.test(result)) {
    throw new CliError(`Invalid ${field} package metadata.`);
  }
  return result;
}

module.exports = {
  CliError,
  EXIT_CODES,
  normalizePluginName,
  readProjectPackage,
  safeControlValue,
  validatePluginId,
};
