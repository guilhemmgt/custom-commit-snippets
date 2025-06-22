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

	// when the active snippets file is updated, load it 
	vscode.workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration('customCommitSnippets.scopeVariants')) {
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
	// command: openSnippetsFolder
	context.subscriptions.push(
		vscode.commands.registerCommand('customCommitSnippets._openSnippetsFolder', async () => {
			const snippetsFolder = await getGlobalSnippetsFilesFolder(context);
			const uri = vscode.Uri.file(snippetsFolder);
			vscode.env.openExternal(uri);
		})
	);
}

/** Displays a 'quick pick' prompting the user to select a snippets file. */
async function promptSnippetsFileSelection(context: vscode.ExtensionContext): Promise<string | undefined> {
	const snippetsFilesFolder = await getGlobalSnippetsFilesFolder(context);
	const filesNames = fs.readdirSync(snippetsFilesFolder).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
	const newFileOption = `$(new-file) Create new snippets file...`;

	const selected = await vscode.window.showQuickPick([...filesNames, newFileOption], { placeHolder: "Select a snippets file to use..." });
	if (!selected)
		return;

	if (selected === newFileOption) {
		const input = await vscode.window.showInputBox({
			prompt: 'Name your new snippets file:',
			validateInput: value => {
				if (!value || value.trim() === '') return 'Filename cannot be empty';
				if (!/^[\w\-]+$/.test(value)) return 'Only letters, numbers, underscores and dashes allowed';
				if (filesNames.includes(value)) return 'File already exists';
				return null;
			}
		});
		if (!input)
			return;

		// create file
		const newFilePath = path.join(snippetsFilesFolder, `${input}.json`);
		await fs.promises.writeFile(newFilePath, '[\n\n]\n', 'utf8');
		// open file + position cursor
		const editor = await vscode.window.showTextDocument(vscode.Uri.file(newFilePath));
		const position = new vscode.Position(1, 0);
		editor.selection = new vscode.Selection(position, position);

		return input;
	}

	return selected;
}

/** Loads the snippets from the currently active file. Defaults to 'conventional'. */
async function loadSnippets(context: vscode.ExtensionContext) {
	const activeFile = vscode.workspace.getConfiguration('customCommitSnippets').get<string>('activeFile') || 'conventional';

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

						if (vscode.workspace.getConfiguration('customCommitSnippets').get<boolean>('scopeVariants', true)) {
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
