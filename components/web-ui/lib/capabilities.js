'use strict';

const { CAPABILITIES } = require('./doctor-capabilities');
const { CliError, EXIT_CODES } = require('./project');

function listCapabilities() {
  return CAPABILITIES.map((capability) => ({
    id: capability.id,
    label: capability.label,
    rpc: `${capability.module}.${capability.rpcMethod}`,
    gate: capability.gate ? { ...capability.gate } : null,
  }));
}

function capabilitiesCli(args, options) {
  if (args.length) {
    throw new CliError('Usage: glplugin capabilities', EXIT_CODES.USAGE);
  }
  const capabilities = listCapabilities();
  if (!options.json) {
    capabilities.forEach((capability) => {
      const gate = capability.gate
        ? `; gate=${capability.gate.source}.${capability.gate.key}`
        : '';
      options.log(`${capability.id}: ${capability.rpc}${gate}`);
    });
  }
  return { capabilities };
}

module.exports = {
  cli: capabilitiesCli,
  listCapabilities,
};
