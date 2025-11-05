import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('colorbar.apply', async () => {
        try {
            const config = vscode.workspace.getConfiguration();
            const current = config.get<Record<string, unknown>>('workbench.colorCustomizations') || {};

            const existingActive = (current as Record<string, string>)[
                'titleBar.activeBackground'
            ] as string | undefined;

            const input = await vscode.window.showInputBox({
                title: 'Pick Title Bar Color',
                prompt:
                    'Enter a hex color for the active title bar background (e.g. #1f6feb or 1f6feb). Inactive will use the same with alpha a4.',
                value: existingActive ?? '#1f6feb',
                validateInput: (val: string) => {
                    const hex = val.trim().replace(/^#/, '');
                    if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) {
                        return null;
                    }
                    return 'Enter a 6 or 8 digit hex color (with or without #)';
                }
            });

            if (!input) {
                return; // cancelled
            }

            // Normalize to #RRGGBB for active, then append a4 for inactive
            const raw = input.trim();
            const hex = raw.startsWith('#') ? raw.slice(1) : raw;
            const base6 = hex.length === 8 ? hex.slice(0, 6) : hex; // strip alpha if present
            const upper = base6.toLowerCase();
            const active = `#${upper}`;
            const inactive = `#${upper}a4`;

            const patch: Record<string, string> = {
                'titleBar.activeBackground': active,
                'titleBar.inactiveBackground': inactive
            };

            const merged = { ...(<Record<string, unknown>>current), ...patch };

            await config.update(
                'workbench.colorCustomizations',
                merged,
                vscode.ConfigurationTarget.Workspace
            );

            vscode.window.showInformationMessage('Updated title bar active/inactive background colors.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to apply color customizations: ${err?.message ?? err}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    // no-op
}
