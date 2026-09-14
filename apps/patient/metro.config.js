// Metro configuration for the MediBook npm-workspaces monorepo.
// Workspace packages (@medibook/brand, @medibook/core) ship TypeScript sources,
// so Metro must watch the repo root and resolve modules from both node_modules
// levels.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
