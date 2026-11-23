const storageKey = 'litesimulation.shortcuts.v1';
const modifiers = {ctrlKey: 'Ctrl', altKey: 'Alt', shiftKey: 'Shift', metaKey: 'Meta'};
const sideButtons = {3: {label: '鼠标后退侧键', mask: 8}, 4: {label: '鼠标前进侧键', mask: 16}};

export function normalizeShortcutBinding(binding) {
    if (binding?.button === 3 || binding?.button === 4) return {button: binding.button};
    if (typeof binding?.key !== 'string') return null;
    const key = binding.key.toLowerCase();
    // 保留 Esc、Delete、Tab 等现有交互按键，只录入可见字符及功能键。
    if (!/^(?:[^\s]|f(?:[1-9]|1[0-2]))$/u.test(key)) return null;
    const normalized = {key};
    for (const modifier of Object.keys(modifiers)) {
        if (binding[modifier] === true) normalized[modifier] = true;
    }
    return normalized;
}

export function formatShortcutBinding(binding) {
    if (binding.button !== undefined) return sideButtons[binding.button].label;
    return [
        ...Object.entries(modifiers).filter(([key]) => binding[key]).map(([, label]) => label),
        binding.key.toUpperCase(),
    ].join(' + ');
}

function withDefaults(saved, defaults) {
    return Object.fromEntries(Object.entries(defaults).map(([id, binding]) => [
        id, normalizeShortcutBinding(saved?.[id]) ?? {...binding},
    ]));
}

export function loadShortcutBindings(target, defaults) {
    try {
        return withDefaults(JSON.parse(target.localStorage.getItem(storageKey)), defaults);
    } catch {
        return withDefaults(null, defaults);
    }
}

export function saveShortcutBindings(target, bindings, defaults) {
    const normalized = withDefaults(bindings, defaults);
    target.localStorage.setItem(storageKey, JSON.stringify(normalized));
    return normalized;
}

function isEditing(target) {
    return Boolean(target?.isContentEditable ||
        target?.closest?.('input, textarea, select, dialog, [role="textbox"], [role="dialog"]'));
}

function matchesBinding(event, binding) {
    if (event.type !== 'keydown') return binding.button !== undefined && event.button === binding.button;
    return binding.key !== undefined && event.key?.toLowerCase() === binding.key &&
        Object.keys(modifiers).every(key => Boolean(event[key]) === Boolean(binding[key]));
}

// 窗口内统一分发快捷键，配置只记录按键，命令由应用提供。
export function installShortcuts(target, bindings, commands) {
    const entries = Object.entries(bindings);
    const eventTypes = new Set(entries.flatMap(([, binding]) =>
        binding.button === undefined ? ['keydown'] : ['mousedown', 'mouseup', 'auxclick']));
    const handleShortcut = event => {
        if (event.defaultPrevented) return;
        const match = entries.find(([, binding]) => matchesBinding(event, binding));
        if (!match) return;
        const [commandId, binding] = match;
        const mouse = binding.button !== undefined;
        // 阻止已绑定的侧键触发页面导航，抬起时不重复执行命令。
        if (mouse) {
            event.preventDefault();
            if (event.type !== 'mousedown' || (event.buttons & ~sideButtons[binding.button].mask)) return;
        }
        if (event.isComposing || isEditing(event.target) || isEditing(target.document?.activeElement)) return;
        event.preventDefault();
        if (!event.repeat) commands[commandId]?.(event);
    };
    const listenerOptions = {capture: true};
    for (const type of eventTypes) target.addEventListener(type, handleShortcut, listenerOptions);
    return () => {
        for (const type of eventTypes) target.removeEventListener(type, handleShortcut, listenerOptions);
    };
}
