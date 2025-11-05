import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('colorbar.apply', async () => {
        try {
            const config = vscode.workspace.getConfiguration();
            const current = config.get<Record<string, unknown>>('workbench.colorCustomizations') || {};

            const existingActive = (current as Record<string, string>)[
                'titleBar.activeBackground'
            ] as string | undefined;

            // Open a webview with a native <input type="color"> to pick a color
            const picked = await pickHexColorWebview(existingActive ?? '#1f6feb');
            if (!picked) {
                return; // cancelled or closed without selection
            }

            // Normalize to #RRGGBB for active, then append a4 for inactive
            const raw = picked.trim();
            const hex = raw.startsWith('#') ? raw.slice(1) : raw;
            const base6 = hex.length === 8 ? hex.slice(0, 6) : hex; // strip alpha if present
            const upper = base6.toLowerCase();
            const active = `#${upper}`;
            const inactive = `#${upper}a4`;

            const patch: Record<string, string> = {
                'titleBar.activeBackground': active,
                'titleBar.inactiveBackground': inactive,
                // activityBar does not support separate active/inactive backgrounds; it has a single background color
                'activityBar.background': active
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

async function pickHexColorWebview(defaultColor: string): Promise<string | undefined> {
    const panel = vscode.window.createWebviewPanel(
        'colorbarPicker',
        'Pick Color',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: false }
    );

    const initial = toSixDigitHex(defaultColor);
    const nonce = getNonce();
    panel.webview.html = getWebviewContent(panel.webview, initial, nonce);

    return await new Promise<string | undefined>((resolve) => {
        let resolved = false;
        const disposeAndResolve = (val: string | undefined) => {
            if (resolved) return;
            resolved = true;
            try { panel.dispose(); } catch { }
            resolve(val);
        };

        panel.webview.onDidReceiveMessage((msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'color' && typeof msg.value === 'string') {
                disposeAndResolve(msg.value);
            } else if (msg.type === 'cancel') {
                disposeAndResolve(undefined);
            }
        });

        panel.onDidDispose(() => disposeAndResolve(undefined));
    });
}

function getWebviewContent(webview: vscode.Webview, initial: string, nonce: string): string {
    const csp = [
        `default-src 'none';`,
        `img-src ${webview.cspSource} https: data:;`,
        `style-src 'unsafe-inline' ${webview.cspSource};`,
        `script-src 'nonce-${nonce}';`
    ].join(' ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
        .row { display: flex; align-items: center; gap: 12px; }
        input[type=color] { width: 48px; height: 32px; border: none; background: transparent; }
        input[type=text] { width: 110px; }
        .buttons { margin-top: 16px; display: flex; gap: 8px; }
        button { padding: 6px 10px; }
    </style>
    <title>Pick Color</title>
    </head>
    <body>
        <div class="row">
            <input id="picker" type="color" value="${initial}">
            <input id="hex" type="text" value="${initial}">
        </div>
        <div class="buttons">
            <button id="ok">Apply</button>
            <button id="cancel">Cancel</button>
        </div>
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const picker = document.getElementById('picker');
            const hex = document.getElementById('hex');
            const ok = document.getElementById('ok');
            const cancel = document.getElementById('cancel');

            function toSix(h){
                h = (h || '').trim();
                if(!h) return '#1f6feb';
                if(h[0] !== '#') h = '#' + h;
                if(/^#([0-9a-fA-F]{6})$/.test(h)) return h.toLowerCase();
                if(/^#([0-9a-fA-F]{3})$/.test(h)) {
                    return '#' + h.slice(1).split('').map(c => c + c).join('').toLowerCase();
                }
                if(/^#([0-9a-fA-F]{8})$/.test(h)) return '#' + h.slice(1,7).toLowerCase();
                return '#1f6feb';
            }

            function syncFromPicker(){ hex.value = toSix(picker.value); }
            function syncFromText(){ picker.value = toSix(hex.value); hex.value = picker.value; }

            picker.addEventListener('input', syncFromPicker);
            hex.addEventListener('input', syncFromText);

            ok.addEventListener('click', () => {
                vscode.postMessage({ type: 'color', value: toSix(hex.value) });
            });
            cancel.addEventListener('click', () => {
                vscode.postMessage({ type: 'cancel' });
            });
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { ok.click(); }
                if (e.key === 'Escape') { cancel.click(); }
            });
        </script>
    </body>
</html>`;
}

function toSixDigitHex(input: string): string {
    const raw = (input || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
    if (/^[0-9a-fA-F]{3}$/.test(raw)) return `#${raw.toLowerCase().split('').map(c => c + c).join('')}`;
    if (/^[0-9a-fA-F]{8}$/.test(raw)) return `#${raw.slice(0, 6).toLowerCase()}`;
    return '#1f6feb';
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
