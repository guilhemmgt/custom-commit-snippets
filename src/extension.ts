import path from 'path';
import fs, { watch } from 'fs';
import * as vscode from 'vscode';

let completionProvider: vscode.Disposable | undefined;
let entries: SnippetEntry[] = [];

interface SnippetEntry {
	name: string;
	content: string;
	description: string;
}

export async function activate(context: vscode.ExtensionContext) {
	await context.globalState.update('customCommitSnippets.initialized', undefined);

	// on its very first activation, initialize the extension by creating the default presets
	const alreadyInitialized = context.globalState.get<boolean>('customCommitSnippets.initialized');
	if (!alreadyInitialized) {
		await resetDefaultPresets(context);
		await context.globalState.update('customCommitSnippets.initialized', true);
	}

	// on activation, register the active preset
	await registerSnippets(context);

	// create a watcher to watch changes to preset files
	await watchPresetChanges(context);

	// when the active preset is updated, register the active preset
	vscode.workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration('customCommitSnippets.activePreset')) {
			await registerSnippets(context);
		}
	});

	// commands
	context.subscriptions.push(
		vscode.commands.registerCommand('customCommitSnippets.resetDefaultPresets', async () => {
			await resetDefaultPresets(context);
			vscode.window.showInformationMessage('Default presets have been reset.');
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('customCommitSnippets.selectPreset', async () => {
			const selected = await promptPresetSelection(context);
			if (!selected)
				return;
			await vscode.workspace.getConfiguration('customCommitSnippets').update('activePreset', selected, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Active preset set to "${selected}"`);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('customCommitSnippets.editPreset', async () => {
			const selected = await promptPresetSelection(context);
			if (!selected)
				return;
			const presetPath = path.join(await getGlobalPresetsFolder(context), `${selected}.json`);
			if (!fs.existsSync(presetPath))
				vscode.window.showErrorMessage(`Could not open preset "${selected}.json".`);
			const presetUri = vscode.Uri.file(presetPath);
			await vscode.window.showTextDocument(presetUri);
		})
	);
}

async function watchPresetChanges(context: vscode.ExtensionContext) {
	const presetsFolder = await getGlobalPresetsFolder(context);
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(presetsFolder, '*.json'));

	const onChange = async () => {
		await registerSnippets(context);
	};

	watcher.onDidChange(onChange);
	watcher.onDidCreate(onChange);

	context.subscriptions.push(watcher);
}

async function promptPresetSelection(context: vscode.ExtensionContext): Promise<string | undefined> {
	const presetsFolder = await getGlobalPresetsFolder(context);
	const presetsNames = fs.readdirSync(presetsFolder).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));

	return await vscode.window.showQuickPick(presetsNames, { placeHolder: "Select a commit snippet preset" });
}

async function registerSnippets(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('customCommitSnippets');
	const activePreset = config.get<string>('activePreset') || 'conventional';
	
	try {
		entries = await getPreset(context, activePreset);
	} catch (e) {
		vscode.window.showErrorMessage(`Failed to load preset "${activePreset}": ${e}`);
	}

	if (!completionProvider) {
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
}

async function resetDefaultPresets(context: vscode.ExtensionContext) {
	const defaultPresetsFolderUri = vscode.Uri.joinPath(context.extensionUri, 'presets');
	const defaultPresetsFiles = await vscode.workspace.fs.readDirectory(defaultPresetsFolderUri);
	const globalPresetsFolderPath = await getGlobalPresetsFolder(context);

	for (const [fileName, fileType] of defaultPresetsFiles) {
		if (fileType !== vscode.FileType.File || !fileName.endsWith('.json'))
			continue;
		const src = vscode.Uri.joinPath(defaultPresetsFolderUri, fileName);
		const dest = path.join(globalPresetsFolderPath, fileName);
		const srcContent = await vscode.workspace.fs.readFile(src);
		await fs.promises.writeFile(dest, Buffer.from(srcContent));
	}
}

async function getPreset(context: vscode.ExtensionContext, presetName: string): Promise<SnippetEntry[]> {
	const folderPath = await getGlobalPresetsFolder(context);
	const presetPath = path.join(folderPath, `${presetName}.json`);
	if (!fs.existsSync(presetPath))
		return [];
	const content = await fs.promises.readFile(presetPath, 'utf8');
	return JSON.parse(content) as SnippetEntry[];
}

async function getGlobalPresetsFolder(context: vscode.ExtensionContext): Promise<string> {
	const presetsFolder = path.join(context.globalStorageUri.fsPath, 'presets');
	if (!fs.existsSync(presetsFolder)) {
		await fs.promises.mkdir(presetsFolder, { recursive: true });
	}
	return presetsFolder;
}
