import sdk = require('../..');
import { createGlApi, glApiMixin } from '../../browser';

const check = sdk.project.check('.', { strict: true });
const project = sdk.project.read('.');
const build = sdk.artifacts.build({ cwd: project.cwd, quiet: true });
const packaged = sdk.artifacts.package({ cwd: project.cwd, quiet: true });
const inspected = sdk.artifacts.inspect(packaged.ipkFile);
const capabilities = sdk.router.listCapabilities();
const exitCode: number = sdk.errors.EXIT_CODES.VALIDATION;
const overlay: string | null = project.manifest.overlay;
const manifestSource: string = project.manifest.source;
const usageError = new sdk.errors.CliError('Invalid input', sdk.errors.EXIT_CODES.USAGE);

void check.ok;
void build.views;
void inspected.metadata.Package;
void capabilities[0].rpc;
void exitCode;
void overlay;
void manifestSource;
void usageError.exitCode;

async function inspectRouter(password: string): Promise<void> {
  const report = await sdk.router.inspect('192.168.8.1', password, {
    requiredCapabilities: ['wifi'],
    requiredMenuViews: ['fixture', 'fixture-tools'],
  });
  const authAlgorithm: string = report.auth.alg;
  void report.compatibility;
  void authAlgorithm;

  const client = await sdk.api.createClient('192.168.8.1', password);
  try {
    const authName: string = client.auth.name;
    const info = await client.system.getInfo();
    const firmwareVersion: string = info.firmware_version;
    const load = await client.system.getLoad();
    const observedMemoryFree: unknown = load.memory_free;
    await client.system.setPassword({
      old_password: 'old',
      new_password: 'new',
    });
    void authName;
    void firmwareVersion;
    void observedMemoryFree;
  } finally {
    await client.close();
  }
}

const browserApi = createGlApi(async () => ({}));
void browserApi.system.getInfo;
glApiMixin.beforeCreate.call({});
void inspectRouter;
