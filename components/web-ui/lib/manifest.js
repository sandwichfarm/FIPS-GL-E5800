'use strict';

const fs = require('fs');
const path = require('path');
const { MINIMUM_FIRMWARE, parseFirmwareVersion } = require('./compatibility');
const { CAPABILITY_IDS } = require('./doctor-capabilities');
const {
  CliError,
  readProjectPackage,
  safeControlValue,
  validatePluginId,
} = require('./project');

const MANIFEST_FILE = 'gl-plugin.json';
const PROFILES = Object.freeze(['ui-only', 'full-stack']);
const LIFECYCLE_NAMES = Object.freeze(['preinst', 'postinst', 'prerm', 'postrm']);
const DEFAULT_DEPENDS = Object.freeze(['libc', 'gl-sdk4-ui-core']);
const MANIFEST_KEYS = Object.freeze([
  '$schema', 'schemaVersion', 'id', 'profile', 'views', 'package', 'compatibility', 'overlay',
  'lifecycle',
]);
const VIEW_KEYS = Object.freeze(['id', 'entry', 'menu']);
const PACKAGE_KEYS = Object.freeze([
  'name', 'architecture', 'section', 'source', 'description', 'depends', 'conffiles',
]);
const COMPATIBILITY_KEYS = Object.freeze([
  'minimumFirmware', 'requiredComponents', 'requiredCapabilities',
]);

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CliError(`Cannot parse ${label}: ${error.message}`);
  }
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError(`"${field}" must be an object.`);
  }
  return value;
}

function assertKnownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new CliError(`Unknown ${field} field: ${unknown[0]}`);
}

function defaulted(value, fallback) {
  return value === undefined ? fallback : value;
}

function validatePackageString(value, field, fallback) {
  const candidate = defaulted(value, fallback);
  if (typeof candidate !== 'string') {
    throw new CliError(`"package.${field}" must be a string.`);
  }
  return safeControlValue(candidate, field[0].toUpperCase() + field.slice(1));
}

function validateRelativePath(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CliError(`"${field}" must be a non-empty relative path.`);
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ||
      /[\0\r\n]/.test(value) || value.includes('\\')) {
    throw new CliError(`"${field}" must stay inside the plugin project.`);
  }

  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized === '..' ||
      normalized.startsWith('../')) {
    throw new CliError(`"${field}" must stay inside the plugin project.`);
  }
  return normalized;
}

function validateDependencies(value) {
  const dependencies = value === undefined ? [...DEFAULT_DEPENDS] : value;
  if (!Array.isArray(dependencies) || dependencies.some((entry) => typeof entry !== 'string')) {
    throw new CliError('"package.depends" must be an array of dependency expressions.');
  }
  return dependencies.map((entry) => safeControlValue(entry, 'Depends'));
}

function validateConffiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new CliError('"package.conffiles" must be an array of absolute package paths.');
  }

  const conffiles = value.map((entry) => {
    if (!entry.startsWith('/') || entry.includes('\\') || entry.includes('\0') ||
        entry.includes('\r') || entry.includes('\n')) {
      throw new CliError(`Invalid conffile path: ${entry}`);
    }
    const normalized = path.posix.normalize(entry);
    if (normalized !== entry || normalized === '/') {
      throw new CliError(`Conffile path must be normalized: ${entry}`);
    }
    return normalized;
  });
  if (new Set(conffiles).size !== conffiles.length) {
    throw new CliError('"package.conffiles" must not contain duplicates.');
  }
  return conffiles;
}

function validateLifecycle(value, profile) {
  if (value === undefined) return {};
  if (profile !== 'full-stack') {
    throw new CliError('"lifecycle" is only supported by the full-stack profile.');
  }

  const lifecycle = assertObject(value, 'lifecycle');
  assertKnownKeys(lifecycle, LIFECYCLE_NAMES, 'lifecycle');

  return Object.fromEntries(Object.entries(lifecycle).map(([name, file]) => [
    name,
    validateRelativePath(file, `lifecycle.${name}`),
  ]));
}

function validateViews(value, pluginId) {
  if (value === undefined) {
    return [{ id: pluginId, entry: 'src/index.vue', menu: 'menu.json' }];
  }
  if (!Array.isArray(value) || !value.length) {
    throw new CliError('"views" must be a non-empty array.');
  }

  const views = value.map((rawView, index) => {
    const view = assertObject(rawView, `views[${index}]`);
    assertKnownKeys(view, VIEW_KEYS, `views[${index}]`);
    return {
      id: validatePluginId(view.id),
      entry: validateRelativePath(view.entry, `views[${index}].entry`),
      menu: validateRelativePath(view.menu, `views[${index}].menu`),
    };
  });
  const duplicateId = views.find((view, index) => (
    views.findIndex((candidate) => candidate.id === view.id) !== index
  ));
  if (duplicateId) throw new CliError(`Duplicate view ID: ${duplicateId.id}`);
  const duplicateMenu = views.find((view, index) => (
    views.findIndex((candidate) => candidate.menu === view.menu) !== index
  ));
  if (duplicateMenu) throw new CliError(`Duplicate view menu path: ${duplicateMenu.menu}`);
  if (!views.some((view) => view.id === pluginId)) {
    throw new CliError(`"views" must include the primary plugin ID "${pluginId}".`);
  }
  const unownedView = views.find((view) => (
    view.id !== pluginId && !view.id.startsWith(`${pluginId}-`)
  ));
  if (unownedView) {
    throw new CliError(
      `View ID "${unownedView.id}" must be namespaced with "${pluginId}-".`
    );
  }
  return views;
}

function validateI18nFilename(filename, pluginId) {
  const prefix = `gl-sdk4-ui-${pluginId}.`;
  if (typeof filename !== 'string' || !filename.startsWith(prefix)) {
    throw new CliError(`i18n filename "${String(filename)}" must start with "${prefix}".`);
  }
  const locale = filename.slice(prefix.length, -'.json'.length);
  if (!filename.endsWith('.json') || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(locale)) {
    throw new CliError(`Invalid i18n filename: ${filename}`);
  }
  return filename;
}

function validateCompatibility(value) {
  const compatibility = value === undefined ? {} : assertObject(value, 'compatibility');
  assertKnownKeys(compatibility, COMPATIBILITY_KEYS, 'compatibility');
  const minimumFirmware = defaulted(compatibility.minimumFirmware, MINIMUM_FIRMWARE);
  if (typeof minimumFirmware !== 'string' || !parseFirmwareVersion(minimumFirmware)) {
    throw new CliError('"compatibility.minimumFirmware" must contain major.minor.');
  }
  const requiredComponents = defaulted(compatibility.requiredComponents, []);
  if (!Array.isArray(requiredComponents) || requiredComponents.some((name) => (
    typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(name)
  ))) {
    throw new CliError(
      '"compatibility.requiredComponents" must contain valid Vue component names.'
    );
  }
  if (new Set(requiredComponents).size !== requiredComponents.length) {
    throw new CliError('"compatibility.requiredComponents" must not contain duplicates.');
  }
  const requiredCapabilities = defaulted(compatibility.requiredCapabilities, []);
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.some((id) => (
    typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)
  ))) {
    throw new CliError(
      '"compatibility.requiredCapabilities" must contain valid capability IDs.'
    );
  }
  if (new Set(requiredCapabilities).size !== requiredCapabilities.length) {
    throw new CliError('"compatibility.requiredCapabilities" must not contain duplicates.');
  }
  const unknownCapabilities = requiredCapabilities.filter((id) => !CAPABILITY_IDS.includes(id));
  if (unknownCapabilities.length) {
    throw new CliError(
      `Unknown compatibility capability: ${unknownCapabilities.join(', ')}`
    );
  }
  return { minimumFirmware, requiredComponents, requiredCapabilities };
}

function normalizeManifest(raw, pkg, source) {
  assertObject(raw, MANIFEST_FILE);
  assertKnownKeys(raw, MANIFEST_KEYS, 'manifest');
  if (raw.$schema !== undefined && typeof raw.$schema !== 'string') {
    throw new CliError('"$schema" must be a string.');
  }
  if (raw.schemaVersion !== 1) {
    throw new CliError('"schemaVersion" must be 1.');
  }

  const id = validatePluginId(raw.id);
  const views = validateViews(raw.views, id);
  const profile = defaulted(raw.profile, 'ui-only');
  if (!PROFILES.includes(profile)) {
    throw new CliError(`Unsupported plugin profile: ${profile}`);
  }

  const packageConfig = raw.package === undefined ? {} : assertObject(raw.package, 'package');
  assertKnownKeys(packageConfig, PACKAGE_KEYS, 'package');
  const compatibility = validateCompatibility(raw.compatibility);
  const conffiles = validateConffiles(packageConfig.conffiles);
  const overlay = raw.overlay === undefined ? null : validateRelativePath(raw.overlay, 'overlay');
  const lifecycle = validateLifecycle(raw.lifecycle, profile);

  if (profile === 'ui-only' && overlay !== null) {
    throw new CliError('"overlay" is only supported by the full-stack profile.');
  }
  if (profile === 'ui-only' && packageConfig.conffiles !== undefined) {
    throw new CliError('"package.conffiles" is only supported by the full-stack profile.');
  }
  if (profile === 'full-stack' && overlay === null) {
    throw new CliError('The full-stack profile requires an "overlay" directory.');
  }

  const fallbackDescription = typeof pkg.description === 'string' && pkg.description.trim()
    ? pkg.description
    : `GL.iNet admin panel plugin: ${id}`;

  return {
    schemaVersion: 1,
    id,
    profile,
    views,
    package: {
      name: validatePackageString(packageConfig.name, 'name', `gl-sdk4-ui-${id}`),
      architecture: validatePackageString(packageConfig.architecture, 'architecture', 'all'),
      section: validatePackageString(packageConfig.section, 'section', 'base'),
      source: validatePackageString(packageConfig.source, 'source', 'gl-sdk4-plugin-kit'),
      description: validatePackageString(
        packageConfig.description, 'description', fallbackDescription
      ),
      depends: validateDependencies(packageConfig.depends),
      conffiles,
    },
    compatibility,
    overlay,
    lifecycle,
    source,
  };
}

function legacyManifest(pkg) {
  const id = validatePluginId(pkg.pluginName);
  const config = pkg.glPlugin || {};
  return normalizeManifest({
    schemaVersion: 1,
    id,
    profile: 'ui-only',
    package: {
      architecture: config.architecture,
      section: config.section,
      source: config.source,
      description: config.description,
      depends: config.depends,
    },
  }, pkg, 'package.json (legacy glPlugin)');
}

function readPluginProject(cwd) {
  const root = path.resolve(cwd || process.cwd());
  const pkg = readProjectPackage(root);
  const manifestPath = path.join(root, MANIFEST_FILE);
  const legacy = !fs.existsSync(manifestPath);
  if (legacy && !pkg.pluginName) {
    throw new CliError(
      `No ${MANIFEST_FILE} found and package.json has no legacy "pluginName" field.`
    );
  }
  const manifest = legacy
    ? legacyManifest(pkg)
    : normalizeManifest(readJson(manifestPath, MANIFEST_FILE), pkg, MANIFEST_FILE);

  return { cwd: root, pkg, manifest, legacy, manifestPath };
}

function resolveProjectPath(project, relativePath, field) {
  const resolved = path.resolve(project.cwd, relativePath);
  const prefix = project.cwd.endsWith(path.sep) ? project.cwd : project.cwd + path.sep;
  if (resolved !== project.cwd && !resolved.startsWith(prefix)) {
    throw new CliError(`"${field}" must stay inside the plugin project.`);
  }
  return resolved;
}

module.exports = {
  DEFAULT_DEPENDS,
  COMPATIBILITY_KEYS,
  LIFECYCLE_NAMES,
  MANIFEST_FILE,
  PROFILES,
  normalizeManifest,
  readPluginProject,
  resolveProjectPath,
  validateCompatibility,
  validateI18nFilename,
  validateRelativePath,
  validateViews,
};
