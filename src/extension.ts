import * as vscode from 'vscode';

// Explanatory text shown above the color picker webview (supports HTML)
const INSTRUCTIONS = `<h1>Pick a color to customize your workspace UI.</h1>
<p>This will change workbench.colorCustomizations in your workspace settings.json. This allows you to quickly distinguish different VS Code windows by color-coding the title bar and activity bar.</p>
<p>Use Apply to save, Reset to remove these keys, or Cancel/Escape to revert to the previous values.</p>`;

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('colorbar.apply', async () => {
        try {
            const config = vscode.workspace.getConfiguration();
            const current = config.get<Record<string, unknown>>('workbench.colorCustomizations') || {};
            const existingActive = (current as Record<string, string>)[
                'titleBar.activeBackground'
            ] as string | undefined;

            // Webview picker handles live preview, apply, reset, and cancel (with restore)
            await pickHexColorWebview(existingActive ?? '#1f6feb');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to apply color customizations: ${err?.message ?? err}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    // no-op
}

async function pickHexColorWebview(defaultColor: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'colorbarPicker',
        'Pick Color',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: false }
    );

    const initial = toSixDigitHex(defaultColor);
    const nonce = getNonce();
    panel.webview.html = getWebviewContent(panel.webview, initial, nonce, INSTRUCTIONS);

    // Track current values to restore on cancel
    const keys = [
        'titleBar.activeBackground',
        'titleBar.inactiveBackground',
        'titleBar.activeForeground',
        'titleBar.inactiveForeground',
        'activityBar.background',
        'activityBar.foreground'
    ];
    const snapshot = await snapshotColorValues(keys);

    let finalized = false; // set when Apply or Reset is invoked

    const applyColor = async (sixHex: string) => {
        const active = sixHex;
        const inactive = `${sixHex}a4`;
        const fg = pickContrastingForeground(sixHex);
        // Make the active item background a bit lighter if text is white, darker if text is black
        const actItem = fg === '#ffffff' ? adjustLightness(sixHex, 0.12) : adjustLightness(sixHex, -0.12);
        const patch: Record<string, string> = {
            'titleBar.activeBackground': active,
            'titleBar.inactiveBackground': inactive,
            'titleBar.activeForeground': fg,
            'titleBar.inactiveForeground': fg,
            'activityBar.background': active,
            'activityBar.foreground': fg,
            'activityBar.activeBackground': actItem
        };
        await mergeColorCustomizations(patch);
    };

    const resetKeys = async () => {
        await removeColorKeys(keys);
    };

    const restore = async () => {
        await restoreSnapshot(snapshot);
    };

    return await new Promise<void>((resolve) => {
        const disposeAndResolve = async (doRestore: boolean) => {
            try {
                if (doRestore && !finalized) {
                    await restore();
                }
            } finally {
                try { panel.dispose(); } catch { }
                resolve();
            }
        };

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'preview' && typeof msg.value === 'string') {
                const six = toSixDigitHex(msg.value);
                await applyColor(six);
            } else if (msg.type === 'apply' && typeof msg.value === 'string') {
                const six = toSixDigitHex(msg.value);
                await applyColor(six);
                finalized = true;
                vscode.window.showInformationMessage('Applied workspace color customizations.');
                await disposeAndResolve(false);
            } else if (msg.type === 'reset') {
                await resetKeys();
                finalized = true;
                vscode.window.showInformationMessage('Reset workspace color customizations for title and activity bar.');
                await disposeAndResolve(false);
            } else if (msg.type === 'cancel') {
                await disposeAndResolve(true);
            }
        });

        panel.onDidDispose(() => {
            // Treat closing the panel as cancel (restore original)
            disposeAndResolve(true);
        });
    });
}

function getWebviewContent(webview: vscode.Webview, initial: string, nonce: string, instructions: string): string {
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
    .instructions { margin-bottom: 12px; white-space: pre-line; line-height: 1.35; }
    .buttons { margin-top: 16px; display: flex; gap: 8px; }
        button { padding: 6px 10px; }
    </style>
    <title>Pick Color</title>
    </head>
    <body>
    <div class="instructions">${instructions}</div>
    <div class="row">
            <input id="picker" type="color" value="${initial}">
            <input id="hex" type="text" value="${initial}">

            <button id="ok">Apply</button>
            <button id="reset">Reset</button>
            <button id="cancel">Cancel</button>
        </div>
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const picker = document.getElementById('picker');
            const hex = document.getElementById('hex');
            const ok = document.getElementById('ok');
            const reset = document.getElementById('reset');
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

            function syncFromPicker(){ hex.value = toSix(picker.value); preview(); }
            function syncFromText(){ picker.value = toSix(hex.value); hex.value = picker.value; preview(); }

            picker.addEventListener('input', syncFromPicker);
            hex.addEventListener('input', syncFromText);

            function preview(){ vscode.postMessage({ type: 'preview', value: toSix(hex.value) }); }

            ok.addEventListener('click', () => { vscode.postMessage({ type: 'apply', value: toSix(hex.value) }); });
            reset.addEventListener('click', () => { vscode.postMessage({ type: 'reset' }); });
            cancel.addEventListener('click', () => {
                vscode.postMessage({ type: 'cancel' });
            });
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { ok.click(); }
                if (e.key === 'Escape') { cancel.click(); }
            });

            // Initial preview to reflect the starting color
            preview();
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

function pickContrastingForeground(bgSixHex: string): string {
    // Choose black or white text based on WCAG contrast ratio
    const lum = relativeLuminance(bgSixHex);
    const contrastWithBlack = (lum + 0.05) / 0.05; // black luminance = 0
    const contrastWithWhite = 1.05 / (lum + 0.05); // white luminance = 1
    return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
}

function relativeLuminance(hex: string): number {
    const { r, g, b } = hexToRgb01(hex);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const R = lin(r);
    const G = lin(g);
    const B = lin(b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
    const six = toSixDigitHex(hex).slice(1);
    const r = parseInt(six.slice(0, 2), 16) / 255;
    const g = parseInt(six.slice(2, 4), 16) / 255;
    const b = parseInt(six.slice(4, 6), 16) / 255;
    return { r, g, b };
}

// Lighten/darken a color by a fractional amount (e.g., 0.12 to lighten 12%, -0.12 to darken 12%)
function adjustLightness(hex: string, amount: number): string {
    const six = toSixDigitHex(hex).slice(1);
    let r = parseInt(six.slice(0, 2), 16);
    let g = parseInt(six.slice(2, 4), 16);
    let b = parseInt(six.slice(4, 6), 16);
    const lighten = amount > 0;
    const a = Math.min(1, Math.max(0, Math.abs(amount)));
    const mix = (c: number) => {
        const v = lighten ? Math.round(c + (255 - c) * a) : Math.round(c * (1 - a));
        return Math.max(0, Math.min(255, v));
    };
    r = mix(r); g = mix(g); b = mix(b);
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function mergeColorCustomizations(patch: Record<string, string>): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const current = config.get<Record<string, any>>('workbench.colorCustomizations') || {};
    const merged = { ...current, ...patch };
    await config.update('workbench.colorCustomizations', merged, vscode.ConfigurationTarget.Workspace);
}

async function removeColorKeys(keys: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const current = { ...(config.get<Record<string, any>>('workbench.colorCustomizations') || {}) };
    for (const k of keys) delete current[k];
    const empty = Object.keys(current).length === 0;
    await config.update('workbench.colorCustomizations', empty ? undefined : current, vscode.ConfigurationTarget.Workspace);
}

async function snapshotColorValues(keys: string[]): Promise<Map<string, string | undefined>> {
    const config = vscode.workspace.getConfiguration();
    const current = config.get<Record<string, any>>('workbench.colorCustomizations') || {};
    const map = new Map<string, string | undefined>();
    for (const k of keys) {
        map.set(k, typeof current[k] === 'string' ? (current[k] as string) : undefined);
    }
    return map;
}

async function restoreSnapshot(snapshot: Map<string, string | undefined>): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const current = { ...(config.get<Record<string, any>>('workbench.colorCustomizations') || {}) };
    for (const [k, v] of snapshot.entries()) {
        if (typeof v === 'string') current[k] = v;
        else delete current[k];
    }
    const empty = Object.keys(current).length === 0;
    await config.update('workbench.colorCustomizations', empty ? undefined : current, vscode.ConfigurationTarget.Workspace);
}
