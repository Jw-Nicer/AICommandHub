import { POCPPluginClient, type PluginConfig } from './pocp-client';
import { FileWatcher } from './file-watcher';
import { StatusBar, type StatusBarItem } from './status-bar';
import { Commands } from './commands';

let client: POCPPluginClient | null = null;
let fileWatcher: FileWatcher | null = null;
let statusBar: StatusBar | null = null;
let commands: Commands | null = null;

export async function activate(config: PluginConfig): Promise<{
  fileWatcher: FileWatcher;
  statusBar: StatusBar;
  commands: Commands;
}> {
  client = new POCPPluginClient(config);
  await client.authenticate();

  // Start heartbeat
  client.startHeartbeat(60000);

  // Initialize file watcher
  fileWatcher = new FileWatcher(client, 5);

  // Initialize status bar
  statusBar = new StatusBar(client, (item: StatusBarItem) => {
    // IDE integration point: update the IDE's status bar
    console.log(`[StatusBar] ${item.text} (${item.color})`);
  });
  statusBar.start(30000);

  // Initialize commands
  commands = new Commands(client);

  // Query memory for project context on activation
  try {
    const context = await client.queryMemory('codebase');
    console.log(`POCP: Loaded ${(context as unknown[]).length} memory entries`);
  } catch {
    console.log('POCP: No memory context available');
  }

  console.log('POCP: Antigravity IDE plugin activated');

  return { fileWatcher, statusBar, commands };
}

export function deactivate(): void {
  if (statusBar) statusBar.stop();
  if (client) client.disconnect();
  client = null;
  fileWatcher = null;
  statusBar = null;
  commands = null;
  console.log('POCP: Antigravity IDE plugin deactivated');
}

// Re-export for IDE integration
export { POCPPluginClient } from './pocp-client';
export { FileWatcher } from './file-watcher';
export { StatusBar } from './status-bar';
export { Commands } from './commands';
export type { PluginConfig } from './pocp-client';
export type { StatusBarItem } from './status-bar';
