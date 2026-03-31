/**
 * Kitsune Migration Agent — VS Code Extension Entry Point
 *
 * Registers the @kitsune Copilot Chat participant and VS Code commands.
 */

import * as vscode from 'vscode';
import { kitsuneHandler } from './participant/KitsuneParticipant.js';

export function activate(context: vscode.ExtensionContext): void {
  // ── Register the Copilot Chat participant ──────────────────────────────
  const participant = vscode.chat.createChatParticipant('kitsune', kitsuneHandler);

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'kitsune.png');

  // ── Register VS Code commands ──────────────────────────────────────────

  context.subscriptions.push(
    participant,

    vscode.commands.registerCommand('kitsune.openLatestGuide', async () => {
      const config = vscode.workspace.getConfiguration('kitsune');
      const outputDir = config.get<string>('outputDirectory') ?? '.kitsune';

      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.[0]) {
        vscode.window.showErrorMessage('Kitsune: No workspace is open.');
        return;
      }

      const dirUri = vscode.Uri.joinPath(folders[0].uri, outputDir);
      let entries: [string, vscode.FileType][];

      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        vscode.window.showInformationMessage(
          `Kitsune: No migration guides found in \`${outputDir}\`. ` +
          'Generate one with @kitsune first.'
        );
        return;
      }

      const mdFiles = entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
        .map(([name]) => name)
        .sort()
        .reverse(); // Most recent first (YYYY-MM-DD prefix)

      if (mdFiles.length === 0) {
        vscode.window.showInformationMessage('Kitsune: No migration guides found.');
        return;
      }

      const chosen = mdFiles.length === 1
        ? mdFiles[0]!
        : await vscode.window.showQuickPick(mdFiles, {
            title: 'Open Migration Guide',
            placeHolder: 'Select a migration guide',
          });

      if (!chosen) { return; }

      const fileUri = vscode.Uri.joinPath(dirUri, chosen);
      await vscode.commands.executeCommand('markdown.showPreview', fileUri);
    }),

    vscode.commands.registerCommand('kitsune.clearSession', () => {
      // This command clears all in-memory sessions (useful for debugging)
      vscode.window.showInformationMessage(
        'Kitsune: Use @kitsune /reset in the chat to clear your current session.'
      );
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up — participant is disposed via context.subscriptions
}
