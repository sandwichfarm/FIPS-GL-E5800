import type { GlSdk4Api } from './rpc-api';

export * from './rpc-api';

export type PluginProfile = 'ui-only' | 'full-stack';
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type LogFunction = (message: string) => void;
export type RpcFunction = (
  module: string,
  method: string,
  params?: Record<string, unknown>
) => Promise<unknown>;

export interface AuthInfo {
  alg: string;
  name: string;
}

export interface ApiClient extends GlSdk4Api {
  [key: string]: unknown;
  sid: string;
  host: string;
  auth: AuthInfo;
  rpc: RpcFunction;
  close(): Promise<void>;
}

export interface ApiTransportOptions {
  https?: boolean;
  insecure?: boolean;
  timeout?: number;
  transport?: unknown;
}

export interface PluginView {
  id: string;
  entry: string;
  menu: string;
}

export interface PluginCompatibility {
  minimumFirmware: string;
  requiredComponents: string[];
  requiredCapabilities: string[];
}

export interface PluginPackageConfig {
  name: string;
  architecture: string;
  section: string;
  source: string;
  description: string;
  depends: string[];
  conffiles: string[];
}

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  profile: PluginProfile;
  views: PluginView[];
  compatibility: PluginCompatibility;
  package: PluginPackageConfig;
  overlay: string | null;
  lifecycle: Partial<Record<'preinst' | 'postinst' | 'prerm' | 'postrm', string>>;
  source: string;
}

export interface PluginProject {
  cwd: string;
  pkg: Record<string, unknown>;
  manifest: PluginManifest;
  legacy: boolean;
  manifestPath: string;
}

export interface InitProjectOptions {
  cwd?: string;
  profile?: PluginProfile;
  install?: boolean;
  log?: LogFunction;
  json?: boolean;
  quiet?: boolean;
}

export interface InitProjectResult {
  dir: string;
  installed: boolean;
  profile: PluginProfile;
  slug: string;
  viewId: string;
}

export interface CheckProjectOptions {
  strict?: boolean;
}

export interface ProjectCheck {
  id: string;
  status: CheckStatus;
  message: string;
}

export interface CheckProjectReport {
  ok: boolean;
  strict: boolean;
  cwd: string;
  project: { id: string; profile: PluginProfile } | null;
  summary?: Partial<Record<CheckStatus, number>>;
  checks: ProjectCheck[];
}

export interface ArtifactOptions {
  cwd?: string;
  log?: LogFunction;
  quiet?: boolean;
  json?: boolean;
}

export interface BuildViewResult {
  id: string;
  jsFile: string;
  gzFile: string;
}

export interface BuildResult {
  jsFile: string;
  gzFile: string;
  views: BuildViewResult[];
}

export interface PackageResult {
  architecture: string;
  ipkFile: string;
  packageName: string;
  profile: PluginProfile;
}

export interface PackageInspection {
  ok: true;
  file: string;
  size: number;
  formatVersion: string;
  metadata: Record<string, string>;
  scripts: string[];
  conffiles: string[];
  controlFiles: string[];
  dataFiles: string[];
  summary: {
    controlFileCount: number;
    dataFileCount: number;
    viewFiles: string[];
    menuFiles: string[];
  };
}

export interface CapabilityDefinition {
  id: string;
  label: string;
  rpc: string;
  gate: { source: string; key: string } | null;
}

export interface RouterInspectOptions extends ApiTransportOptions {
  username?: string;
  allowUnverified?: boolean;
  minimumFirmware?: string;
  requiredComponents?: string[];
  requiredCapabilities?: string[];
  requiredMenuView?: string;
  requiredMenuViews?: string[];
}

export interface RouterInspection {
  ok: boolean;
  checked_at: string;
  target: string;
  transport: Record<string, unknown>;
  auth: AuthInfo;
  router: Record<string, unknown> | null;
  compatibility: Record<string, unknown> | null;
  capability_contract: Record<string, unknown> | null;
  plugin: Record<string, unknown> | null;
  capabilities: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
  summary?: Record<string, number>;
}

export class CliError extends Error {
  constructor(message: string, exitCode?: number);
  exitCode: number;
  details?: unknown;
  cause?: unknown;
}

export const EXIT_CODES: Readonly<{
  SUCCESS: 0;
  RUNTIME: 1;
  USAGE: 2;
  VALIDATION: 3;
  CONNECTIVITY: 4;
}>;

export const version: string;

export const api: Readonly<{
  createApiClient(rpc: RpcFunction): GlSdk4Api;
  createClient(
    host: string,
    password: string,
    username?: string,
    options?: ApiTransportOptions
  ): Promise<ApiClient>;
}>;

export const project: Readonly<{
  init(name: string, options?: InitProjectOptions): InitProjectResult;
  read(cwd?: string): PluginProject;
  check(cwd?: string, options?: CheckProjectOptions): CheckProjectReport;
}>;

export const artifacts: Readonly<{
  build(options?: ArtifactOptions): BuildResult;
  package(options?: ArtifactOptions): PackageResult;
  inspect(file: string): PackageInspection;
}>;

export const router: Readonly<{
  inspect(
    host: string,
    password: string,
    options?: RouterInspectOptions
  ): Promise<RouterInspection>;
  listCapabilities(): CapabilityDefinition[];
}>;

export const errors: Readonly<{
  CliError: typeof CliError;
  EXIT_CODES: typeof EXIT_CODES;
}>;
