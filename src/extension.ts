import * as vscode from 'vscode';


interface CommitSnippet {
	name: string;
	content: string;
	description: string;
}

export function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration();
	const items = config.get<CommitSnippet[]>('customCommitSnippets.items') || [];
	registerCommitSnippets(items, context);
}

function registerCommitSnippets(items: CommitSnippet[], context: vscode.ExtensionContext) {
	const completionProvider = vscode.languages.registerCompletionItemProvider(
		{ language: 'git-commit' },
		{
			provideCompletionItems() {
				const completions: vscode.CompletionItem[] = [];

				for (const item of items) {
					const completion = new vscode.CompletionItem(item.description, vscode.CompletionItemKind.Snippet);
					completion.insertText = new vscode.SnippetString(`${item.content}: $1`);
					completion.label = `${item.name}`;
					completion.documentation = item.description;
					completions.push(completion);

					const completionWithScope = new vscode.CompletionItem(item.description, vscode.CompletionItemKind.Snippet);
					completionWithScope.insertText = new vscode.SnippetString(`${item.content}($1): `);
					completionWithScope.label = `${item.name}()`;
					completionWithScope.documentation = item.description;
					completions.push(completionWithScope);
				}
				return completions;
			}
		}
	);

	context.subscriptions.push(completionProvider);
}

export function deactivate() { }
