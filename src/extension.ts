import path from 'path';
import fs from 'fs';
import * as vscode from 'vscode';

/** Completion provider used to updates snippets. */
let completionProvider: vscode.Disposable | undefined;
/** Currently loaded snippets. */
let snippets: Snippet[] = [];

interface Snippet {
	name: string;
	content: string;
	description: string;
}

export async function activate(context: vscode.ExtensionContext) {
	// on its very first activation, initialize the extension by creating snippets files corresponding to the presets
	const alreadyInitialized = context.globalState.get<boolean>('customCommitSnippets.initialized');
	if (!alreadyInitialized) {
		await resetDefaultPresets(context);
		await context.globalState.update('customCommitSnippets.initialized', true);
	}

	// on activation...
	await loadSnippets(context);

	// create a watcher to watch changes to snippets files
	{
		const snippetsFilesFolder = await getGlobalSnippetsFilesFolder(context);
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(snippetsFilesFolder, '*.json'));
		const onChange = async () => {
			await loadSnippets(context);
		};
		watcher.onDidChange(onChange);
		watcher.onDidCreate(onChange);
		context.subscriptions.push(watcher);
	}

	// when the active snippets file is updated, load it 
	vscode.workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration('customCommitSnippets.activeFile')) {
			await loadSnippets(context);
		}
	});

	// command: resetDefaultPresets
	context.subscriptions.push(
		vscode.commands.registerCommand('customCommitSnippets.resetDefaultPresets', async () => {
			await resetDefaultPresets(context);
			vscode.window.showInformationMessage('Default presets have been reset.');
		})
	);
	// command: selectFile
	context.subscriptions.push(
		vscode.commands.registerCommand('customCommitSnippets.selectFile', async () => {
			const selected = await promptSnippetsFileSelection(context);
			if (!selected)
				return;
			await vscode.workspace.getConfiguration('customCommitSnippets').update('activeFile', selected, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Active snippets file set to "${selected}"`);
		})
	);
	// command: editFile
	context.subscriptions.push(
		vscode.commands.registerCommand('customCommitSnippets.editFile', async () => {
			const selected = await promptSnippetsFileSelection(context);
			if (!selected)
				return;
			const filePath = path.join(await getGlobalSnippetsFilesFolder(context), `${selected}.json`);
			if (!fs.existsSync(filePath))
				vscode.window.showErrorMessage(`Could not open snippets file "${selected}.json".`);
			const fileUri = vscode.Uri.file(filePath);
			await vscode.window.showTextDocument(fileUri);
		})
	);
}

/** Displays a 'quick pick' prompting the user to select a snippets file. */
async function promptSnippetsFileSelection(context: vscode.ExtensionContext): Promise<string | undefined> {
	const snippetsFilesFolder = await getGlobalSnippetsFilesFolder(context);
	const filesNames = fs.readdirSync(snippetsFilesFolder).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));

	return await vscode.window.showQuickPick(filesNames, { placeHolder: "Select a snippets file to use..." });
}

/** Loads the snippets from the currently active file. Defaults to 'conventional'. */
async function loadSnippets(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('customCommitSnippets');
	const activeFile = config.get<string>('activeFile') || 'conventional';

	// loads the active file
	try {
		snippets = await getSnippets(context, activeFile);
	} catch (e) {
		vscode.window.showErrorMessage(`Failed to load snippets file "${activeFile}": ${e}.`);
	}

	// initialize the provider (only once per activation)
	if (!completionProvider) {
		completionProvider = vscode.languages.registerCompletionItemProvider(
			{ language: 'git-commit' },
			{
				provideCompletionItems() {
					const completions: vscode.CompletionItem[] = [];
					for (const entry of snippets) {
						const completion = new vscode.CompletionItem(entry.description, vscode.CompletionItemKind.Snippet);
						completion.insertText = new vscode.SnippetString(`${entry.content}: $1`);
						completion.label = entry.name || entry.description;
						completion.documentation = entry.description;
						if (!entry.name) {
							completion.filterText = entry.description;
							completion.sortText = entry.description;
						}
						completions.push(completion);

						const completionWithScope = new vscode.CompletionItem(entry.description, vscode.CompletionItemKind.Snippet);
						completionWithScope.insertText = new vscode.SnippetString(`${entry.content}($1): `);
						completionWithScope.label = `${entry.name || entry.description}()`;
						completionWithScope.documentation = entry.description;
						if (!entry.name) {
							completionWithScope.filterText = entry.description;
							completionWithScope.sortText = entry.description;
						}
						completions.push(completionWithScope);
					}
					return completions;
				}
			}
		);
		context.subscriptions.push(completionProvider);
	}
}

/** Resets (writes or overwrites) the snippets files corresponding to the default presets bundled with this extension. */
async function resetDefaultPresets(context: vscode.ExtensionContext) {
	const defaultPresetsFolderUri = vscode.Uri.joinPath(context.extensionUri, 'presets');
	const defaultPresetsFiles = await vscode.workspace.fs.readDirectory(defaultPresetsFolderUri);
	const snippetsFilesFolderPath = await getGlobalSnippetsFilesFolder(context);

	for (const [fileName, fileType] of defaultPresetsFiles) {
		if (fileType !== vscode.FileType.File || !fileName.endsWith('.json'))
			continue;
		const src = vscode.Uri.joinPath(defaultPresetsFolderUri, fileName);
		const dest = path.join(snippetsFilesFolderPath, fileName);
		const srcContent = await vscode.workspace.fs.readFile(src);
		await fs.promises.writeFile(dest, Buffer.from(srcContent));
	}
}

/** Gets snippets from a snippets file. */
async function getSnippets(context: vscode.ExtensionContext, fileName: string): Promise<Snippet[]> {
	const folderPath = await getGlobalSnippetsFilesFolder(context);
	const filepath = path.join(folderPath, `${fileName}.json`);
	if (!fs.existsSync(filepath))
		return [];
	const content = await fs.promises.readFile(filepath, 'utf8');
	return JSON.parse(content) as Snippet[];
}

/** Returns the path to the folder containing the snippets files in the globalStorage. Creates it if necessary. */
async function getGlobalSnippetsFilesFolder(context: vscode.ExtensionContext): Promise<string> {
	const snippetsFilesFolder = path.join(context.globalStorageUri.fsPath, 'snippetsFiles');
	if (!fs.existsSync(snippetsFilesFolder)) {
		await fs.promises.mkdir(snippetsFilesFolder, { recursive: true });
	}
	return snippetsFilesFolder;
}
