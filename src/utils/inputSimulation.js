import {INPUT_PROPERTY_DEFAULTS, getInputRuleValidationMessage, sampleInputRule, getDefaultWorkpieceDimensions} from './inputRules.js';
import {DEFAULT_COMPONENT_SIZES} from './componentAppearance.js';
import {getComponentLabel} from './componentLabel.js';
import {getConnectionGeometry, DEFAULT_WORKPIECE_SPEED} from './connectionLine.js';

const MAX_VISIBLE_STACK_SIZE = 25;

export function createInputSimulation(random = Math.random) {
    const workpieces = [];
    const sources = new Map();
    const stacks = new Map();
    let runId = 0;
    let nextId = 1;
    let hasPendingGeneration = false;

    function reset() {
        workpieces.length = 0;
        sources.clear();
        stacks.clear();
        runId++;
        nextId = 1;
        hasPendingGeneration = false;
    }

    function findOutgoingRoute(componentId, components) {
        for (const line of components) {
            if (line.type !== 'connectionLine' || line.fromId !== componentId) continue;
            const geometry = getConnectionGeometry(line, components);
            if (geometry && geometry.from.id !== geometry.to.id) return {line, ...geometry};
        }
        return null;
    }

    function addToStack(part, component, placement) {
        let stack = stacks.get(component.id);
        if (!stack) {
            stack = {count: 0, visible: [], placement};
            stacks.set(component.id, stack);
        }
        stack.count++;
        part.attachedComponentId = component.id;
        part.angle = 0;
        part.stackHidden = stack.visible.length >= MAX_VISIBLE_STACK_SIZE;
        part.stackCount = stack.count;
        part.offsetX = placement === 'left' ? -part.width : ((component.width ?? 3) - part.width) / 2;
        part.offsetY = ((component.height ?? 3) - part.height) / 2;
        if (part.stackHidden) stack.visible.at(-1).stackCount = stack.count;
        else stack.visible.push(part);
    }

    // position 为中心坐标（米），x/y 为未旋转矩形左下角。
    function updatePosition(part, centerX, centerY) {
        const x = centerX - part.width / 2;
        const y = centerY - part.height / 2;
        const changed = part.x !== x || part.y !== y || part.position?.x !== centerX || part.position?.y !== centerY;
        part.position = {x: centerX, y: centerY};
        part.x = x;
        part.y = y;
        return changed;
    }

    function syncAttachments(components) {
        const byId = new Map(components.map(component => [component.id, component]));
        let changed = false;
        for (const part of workpieces) {
            const source = byId.get(part.sourceId);
            if (!source) continue;
            const actual = source.workpieceDisplayMode === 'actual';
            const width = actual ? part.actualLength : (source.width ?? 3) * 2 / 3;
            const height = actual ? part.actualWidth : (source.height ?? 3) / 3;
            if (part.width !== width || part.height !== height) {
                part.width = width;
                part.height = height;
                changed = true;
            }
        }
        for (const [ownerId, stack] of stacks) {
            const owner = byId.get(ownerId);
            if (!owner) {
                stacks.delete(ownerId);
                continue;
            }
            stack.visible = stack.visible.filter(part => part.attachedComponentId === ownerId && part.status !== 'moving');
            let shift = 0;
            for (let index = stack.visible.length - 1; index >= 0; index--) {
                const part = stack.visible[index];
                part.offsetX = (stack.placement === 'left' ? -part.width : ((owner.width ?? 3) - part.width) / 2) + shift;
                part.offsetY = ((owner.height ?? 3) - part.height) / 2;
                shift += part.width * 0.08;
            }
        }
        for (let index = workpieces.length - 1; index >= 0; index--) {
            const part = workpieces[index];
            const owner = byId.get(part.attachedComponentId);
            const route = part.status === 'moving' ? getConnectionGeometry(owner, components) : null;
            if (!owner || (part.status === 'moving' && !route)) {
                workpieces.splice(index, 1);
                changed = true;
                continue;
            }
            if (route) {
                const progress = route.length === 0 ? 1 : Math.min(1, part.distanceTravelled / route.length);
                if (part.angle !== route.angle) changed = true;
                part.angle = route.angle;
                changed = updatePosition(part, route.start.x + (route.end.x - route.start.x) * progress,
                    route.start.y + (route.end.y - route.start.y) * progress) || changed;
            } else {
                if (part.angle !== 0) changed = true;
                part.angle = 0;
                changed = updatePosition(part, owner.x + part.offsetX + part.width / 2,
                    owner.y + part.offsetY + part.height / 2) || changed;
            }
        }
        for (const sourceId of sources.keys()) if (!byId.has(sourceId)) sources.delete(sourceId);
        return changed;
    }

    function isComplete() {
        return !hasPendingGeneration && workpieces.every(part => part.status === 'stacked' || part.status === 'completed');
    }

    function advanceTo(timeMilliseconds, components) {
        let changed = syncAttachments(components);
        hasPendingGeneration = false;
        for (const input of components.filter(component => component.type === 'systemInput')) {
            const interval = Math.round((input.generationInterval ?? INPUT_PROPERTY_DEFAULTS.generationInterval) * 1000);
            const first = Math.round((input.firstGenerationTime ?? INPUT_PROPERTY_DEFAULTS.firstGenerationTime) * 1000);
            const maximum = input.maxOutputCount ?? INPUT_PROPERTY_DEFAULTS.maxOutputCount;
            const closes = input.inputCloseEnabled ? Math.round((input.inputCloseTime ?? 0) * 1000) : Infinity;
            if (!Number.isSafeInteger(interval) || interval <= 0 || !Number.isSafeInteger(first) || first < 0 ||
                !Number.isSafeInteger(maximum) || maximum < 0) continue;
            const rules = input.inputRuleRows ?? [{partType: 'Part1', name: '', fillColor: '#22c55e', relativeWeight: 100}];
            if (!rules.length || getInputRuleValidationMessage(rules)) continue;
            let state = sources.get(input.id);
            if (!state) {
                state = {count: 0, lastGeneratedAt: null};
                sources.set(input.id, state);
            }
            let due = state.lastGeneratedAt === null ? first : state.lastGeneratedAt + interval;
            const recommendedWidth = (input.width ?? DEFAULT_COMPONENT_SIZES.systemInput.width) * 2 / 3;
            const recommendedHeight = (input.height ?? DEFAULT_COMPONENT_SIZES.systemInput.height) / 3;
            if (!(recommendedWidth > 0 && recommendedHeight > 0 && Number.isFinite(recommendedWidth) && Number.isFinite(recommendedHeight))) continue;
            const route = findOutgoingRoute(input.id, components);
            while (due <= timeMilliseconds && due < closes && state.count < maximum) {
                const rule = sampleInputRule(rules, random);
                const defaults = getDefaultWorkpieceDimensions(input);
                const actualLength = (rule.length ?? defaults.length) / 1000;
                const actualWidth = (rule.width ?? defaults.width) / 1000;
                const width = input.workpieceDisplayMode === 'actual' ? actualLength : recommendedWidth;
                const height = input.workpieceDisplayMode === 'actual' ? actualWidth : recommendedHeight;
                const part = {
                    id: `workpiece-${runId}-${nextId++}`, type: 'workpiece',
                    sourceId: input.id, sourceName: getComponentLabel(input), sequence: ++state.count,
                    attachedComponentId: route ? route.line.id : input.id,
                    status: route ? 'moving' : 'stacked', angle: route ? route.angle : 0,
                    partType: rule.partType, name: rule.name ?? '',
                    fillColor: rule.fillColor ?? '#22c55e', borderColor: '#ff0000',
                    generatedAt: due / 1000, actualLength, actualWidth, width, height,
                    distanceTravelled: 0, lastMotionAt: due,
                    offsetX: -width, offsetY: ((input.height ?? 3) - height) / 2,
                    stackHidden: false,
                };
                workpieces.push(part);
                if (!route) addToStack(part, input, 'left');
                state.lastGeneratedAt = due;
                due += interval;
                changed = true;
            }
            if (state.count < maximum && due < closes) hasPendingGeneration = true;
        }

        // 按各工件的生成时间计算路程，补帧产生的工件只移动生成后经过的时间。
        const arrivals = [];
        for (const part of workpieces) {
            if (part.status !== 'moving') continue;
            const line = components.find(component => component.id === part.attachedComponentId);
            const route = getConnectionGeometry(line, components);
            if (!route) continue;
            const speed = line.workpieceSpeed ?? DEFAULT_WORKPIECE_SPEED;
            if (!Number.isFinite(speed) || speed < 0) continue;
            const elapsed = Math.max(0, timeMilliseconds - part.lastMotionAt) / 1000;
            const remaining = Math.max(0, route.length - part.distanceTravelled);
            if (remaining === 0 || (speed > 0 && speed * elapsed >= remaining - 1e-10)) {
                const arrivedAt = part.lastMotionAt + (speed > 0 ? remaining / speed * 1000 : 0);
                part.distanceTravelled = route.length;
                arrivals.push({part, destination: route.to, arrivedAt});
                changed = true;
            } else {
                if (speed * elapsed > 0) changed = true;
                part.distanceTravelled += speed * elapsed;
            }
            part.lastMotionAt = timeMilliseconds;
        }
        arrivals.sort((a, b) => a.arrivedAt - b.arrivedAt);
        for (const {part, destination, arrivedAt} of arrivals) {
            part.arrivedAt = arrivedAt / 1000;
            part.status = destination.type === 'systemOutput' ? 'completed' :
                (findOutgoingRoute(destination.id, components) ? 'waiting' : 'stacked');
            addToStack(part, destination, 'center');
        }
        return syncAttachments(components) || changed;
    }

    return {workpieces, advanceTo, syncAttachments, isComplete, reset};
}
