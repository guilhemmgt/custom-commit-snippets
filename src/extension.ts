import path from 'path';
import fs from 'fs';
import * as vscode from 'vscode';

const PRESETS_DIR = 'presets';

interface SnippetEntry {
	name: string;
	content: string;
	description: string;
}

export async function activate(context: vscode.ExtensionContext) {
	// const config = vscode.workspace.getConfiguration();
	// const items = config.get<CommitSnippet[]>('customCommitSnippets.items') || [];
	// registerCommitSnippets(items, context);

	await registerSnippets(context);

	vscode.workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration('customCommitSnippets.activePreset')) {
			await registerSnippets(context);
		}
	});
}

async function loadPreset(context: vscode.ExtensionContext, presetName: string): Promise<SnippetEntry[]> {
	const presetPath = path.join(context.extensionPath, PRESETS_DIR, `${presetName}.json`);
	return new Promise((resolve, reject) => {
		fs.readFile(presetPath, 'utf8', (err, data) => {
			if (err) {
				reject(err);
				return;
			}
			try {
				const entries: SnippetEntry[] = JSON.parse(data);
				resolve(entries);
			} catch (parseErr) {
				reject(parseErr);
				return;
			}
		});
	});
}

let completionProvider: vscode.Disposable | undefined;

async function registerSnippets(context: vscode.ExtensionContext) {
	if (completionProvider) {
		completionProvider.dispose();
	}

	const config = vscode.workspace.getConfiguration('customCommitSnippets');
	const activePreset = config.get<string>('activePreset') || 'conventional';

	let entries: SnippetEntry[] = [];
	try {
		entries = await loadPreset(context, activePreset);
	} catch (e) {
		vscode.window.showErrorMessage(`Failed to load preset "${activePreset}": ${e}`);
	}

	completionProvider = vscode.languages.registerCompletionItemProvider(
		{ language: 'git-commit' },
		{
			provideCompletionItems() {
				const completions: vscode.CompletionItem[] = [];
				for (const entry of entries) {
					const completion = new vscode.CompletionItem(entry.description, vscode.CompletionItemKind.Snippet);
					completion.insertText = new vscode.SnippetString(`${entry.content}: $1`);
					completion.label = `${entry.name}`;
					completion.documentation = entry.description;
					completions.push(completion);

					const completionWithScope = new vscode.CompletionItem(entry.description, vscode.CompletionItemKind.Snippet);
					completionWithScope.insertText = new vscode.SnippetString(`${entry.content}($1): `);
					completionWithScope.label = `${entry.name}()`;
					completionWithScope.documentation = entry.description;
					completions.push(completionWithScope);
				}
				return completions;
			}
		}
	);

	context.subscriptions.push(completionProvider);
}

export function deactivate() { }
