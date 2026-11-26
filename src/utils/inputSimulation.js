import {INPUT_PROPERTY_DEFAULTS, INPUT_RULE_DEFAULT_DIMENSIONS, getInputType, getInputRuleCategory, getInputRuleValidationMessage, sampleInputRule, getDefaultWorkpieceDimensions} from './inputRules.js';
import {DEFAULT_COMPONENT_SIZES} from './componentAppearance.js';
import {getComponentLabel} from './componentLabel.js';
import {getConnectionGeometry, getPointOnConnection, DEFAULT_WORKPIECE_SPEED} from './connectionLine.js';
import {WORKSTATION_PROPERTY_DEFAULTS, isValidWorkstationProperty, ensureParallelWorkstationEquipment} from './workstationProperties.js';
import {ASSEMBLY_TIME_TOLERANCE_MS, CONTAINER_TYPES, findAssemblyBatch, getAssemblyPackingType, getAssemblyUnitCount} from './assemblyRecipes.js';
import {findDisassemblyRecipe, getDisassemblyUnitCount} from './disassemblyRecipes.js';
import {getBufferProperty} from './bufferProperties.js';
import {getComponentFootprint} from './stations.js';

const MAX_VISIBLE_STACK_SIZE = 25;

function snapshotWorkpiece(part) {
    const {id, type, partType, name, packingType, sourceId, sourceName, sequence,
        fillColor, borderColor, actualLength, actualWidth, width, height,
        generatedAt, processingHistory, assembly, disassembly, contents, unloadedAt} = part;
    return {id, type, partType, name, packingType, sourceId, sourceName, sequence,
        fillColor, borderColor, actualLength, actualWidth, width, height,
        generatedAt, processingHistory, assembly, disassembly, contents, unloadedAt};
}

export function createInputSimulation(random = Math.random) {
    const workpieces = [];
    const sources = new Map();
    const stacks = new Map();
    const workstations = new Map();
    const assemblyStations = new Map();
    const disassemblyStations = new Map();
    const pendingTransfers = new Map();
    let runId = 0;
    let nextId = 1;
    let hasPendingGeneration = false;
    let lastAdvancedAt = 0;

    function reset() {
        workpieces.length = 0;
        sources.clear();
        stacks.clear();
        workstations.clear();
        assemblyStations.clear();
        disassemblyStations.clear();
        pendingTransfers.clear();
        runId++;
        nextId = 1;
        hasPendingGeneration = false;
        lastAdvancedAt = 0;
    }

    function addToStack(part, component, placement) {
        let stack = stacks.get(component.id);
        if (!stack) {
            stack = {parts: [], placement};
            stacks.set(component.id, stack);
        }
        stack.parts.push(part);
        part.attachedComponentId = component.id;
        part.angle = 0;
        part.offsetX = placement === 'left'
            ? getComponentFootprint(component).x - component.x - part.width
            : ((component.width ?? 3) - part.width) / 2;
        part.offsetY = ((component.height ?? 3) - part.height) / 2;
    }

    function leaveStack(part) {
        const stack = stacks.get(part.attachedComponentId);
        if (stack) {
            stack.parts = stack.parts.filter(item => item !== part);
            if (!stack.parts.length) stacks.delete(part.attachedComponentId);
        }
        part.stackHidden = false;
        delete part.stackCount;
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
        const routes = new Map();
        let changed = false;
        for (const part of workpieces) {
            if ((part.assembly && part.packingType === 'Workpiece') || part.disassembly) continue;
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
            stack.parts = stack.parts.filter(part => part.attachedComponentId === ownerId && part.status !== 'moving');
            const visibleCount = Math.min(stack.parts.length, MAX_VISIBLE_STACK_SIZE);
            const leftOffset = stack.placement === 'left' ? getComponentFootprint(owner).x - owner.x : null;
            for (const [index, part] of stack.parts.entries()) {
                const hidden = index >= visibleCount;
                const count = index === visibleCount - 1 ? stack.parts.length : index + 1;
                if (part.stackHidden !== hidden || part.stackCount !== count) changed = true;
                part.stackHidden = hidden;
                part.stackCount = count;
                if (hidden && leftOffset !== null) part.offsetX = leftOffset - part.width;
            }
            let shift = 0;
            for (let index = visibleCount - 1; index >= 0; index--) {
                const part = stack.parts[index];
                part.offsetX = (leftOffset !== null ? leftOffset - part.width : ((owner.width ?? 3) - part.width) / 2) + shift;
                part.offsetY = ((owner.height ?? 3) - part.height) / 2;
                shift += part.width * 0.08;
            }
        }
        for (let index = workpieces.length - 1; index >= 0; index--) {
            const part = workpieces[index];
            const owner = byId.get(part.attachedComponentId);
            if (part.status === 'moving' && owner && !routes.has(owner.id)) {
                routes.set(owner.id, getConnectionGeometry(owner, components));
            }
            const route = part.status === 'moving' ? routes.get(owner?.id) : null;
            if (!owner || (part.status === 'moving' && !route)) {
                workpieces.splice(index, 1);
                changed = true;
                continue;
            }
            if (route) {
                const point = getPointOnConnection(route, part.distanceTravelled);
                if (part.angle !== point.angle) changed = true;
                part.angle = point.angle;
                changed = updatePosition(part, point.x, point.y) || changed;
            } else {
                if (part.angle !== 0) changed = true;
                part.angle = 0;
                changed = updatePosition(part, owner.x + part.offsetX + part.width / 2,
                    owner.y + part.offsetY + part.height / 2) || changed;
            }
        }
        for (const sourceId of sources.keys()) if (!byId.has(sourceId)) sources.delete(sourceId);
        const liveParts = new Set(workpieces);
        for (const [id, queue] of pendingTransfers) {
            const remaining = queue.filter(({part}) => liveParts.has(part) && part.attachedComponentId === id);
            if (remaining.length) pendingTransfers.set(id, remaining);
            else pendingTransfers.delete(id);
        }
        for (const station of components) {
            if (station.type !== 'workstation' && station.type !== 'parallelWorkstation') continue;
            let state = workstations.get(station.id);
            if (!state) {
                state = {equipment: new Map(), queue: []};
                workstations.set(station.id, state);
            }
            const ids = station.type === 'parallelWorkstation' ? ensureParallelWorkstationEquipment(station) :
                [`${station.id}:equipment:1`];
            const enabledIds = new Set(ids);
            for (const equipment of state.equipment.values()) equipment.enabled = enabledIds.has(equipment.id);
            for (const id of ids) {
                if (!state.equipment.has(id)) state.equipment.set(id, {id, enabled: true, status: 'idle', active: null, records: []});
            }
        }
        for (const [id, state] of workstations) {
            const station = byId.get(id);
            const exists = station?.type === 'workstation' || station?.type === 'parallelWorkstation';
            const attached = part => liveParts.has(part) && part.attachedComponentId === id;
            state.queue = state.queue.filter(attached);
            for (const equipment of state.equipment.values()) {
                if (!exists) equipment.enabled = false;
                if (equipment.active && (!exists || !attached(equipment.active))) {
                    equipment.activeRecord.status = 'cancelled';
                    equipment.activeRecord.cancelledAt = lastAdvancedAt / 1000;
                    equipment.active = null;
                    equipment.activeRecord = null;
                    equipment.status = 'idle';
                }
            }
        }
        for (const [id, state] of assemblyStations) {
            if (byId.get(id)?.type !== 'assemblyWorkstation') {
                assemblyStations.delete(id);
                continue;
            }
            state.waiting = state.waiting.filter(part => liveParts.has(part));
        }
        for (const [id, state] of disassemblyStations) {
            if (byId.get(id)?.type !== 'disassemblyWorkstation') disassemblyStations.delete(id);
            else state.waiting = state.waiting.filter(part => liveParts.has(part));
        }
        return changed;
    }

    function isComplete() {
        return !hasPendingGeneration && workpieces.every(part => part.status === 'stacked' || part.status === 'completed');
    }

    function advanceTo(timeMilliseconds, components) {
        let changed = syncAttachments(components);
        // 发运、到达和工序结束共享时间轴，补帧时也按实际时间占用和释放名额。
        const events = createEventQueue();
        const stationDispatches = new Map();
        const transferDispatches = new Set();
        const byId = new Map(components.map(component => [component.id, component]));
        const outboundRoutes = new Map();
        const inboundBufferLines = new Map();
        const routesByLine = new Map();
        const occupied = new Map();
        const instantaneousRoutes = new Map();
        const schedule = event => {
            if (event.at <= timeMilliseconds) events.push(event);
        };
        for (const line of components) {
            if (line.type !== 'connectionLine' || line.fromId === line.toId) continue;
            const geometry = getConnectionGeometry(line, components);
            if (!geometry) continue;
            routesByLine.set(line.id, geometry);
            if (geometry.to.type === 'buffer') {
                if (inboundBufferLines.has(line.toId)) continue;
                inboundBufferLines.set(line.toId, line);
            }
            if (!outboundRoutes.has(line.fromId)) outboundRoutes.set(line.fromId, {line, ...geometry});
        }
        for (const part of workpieces) {
            const owner = byId.get(part.attachedComponentId);
            const buffer = part.status === 'moving' ? byId.get(owner?.toId) : owner;
            if (buffer?.type === 'buffer') occupied.set(buffer.id, (occupied.get(buffer.id) ?? 0) + 1);
        }

        hasPendingGeneration = false;
        for (const input of components.filter(component => component.type === 'systemInput')) {
            const interval = Math.round((input.generationInterval ?? INPUT_PROPERTY_DEFAULTS.generationInterval) * 1000);
            const first = Math.round((input.firstGenerationTime ?? INPUT_PROPERTY_DEFAULTS.firstGenerationTime) * 1000);
            const maximum = input.maxOutputCount ?? INPUT_PROPERTY_DEFAULTS.maxOutputCount;
            const closes = input.inputCloseEnabled ? Math.round((input.inputCloseTime ?? 0) * 1000) : Infinity;
            if (!Number.isSafeInteger(interval) || interval <= 0 || !Number.isSafeInteger(first) || first < 0 ||
                !Number.isSafeInteger(maximum) || maximum < 0) continue;
            const inputType = getInputType(input);
            const rules = input.inputRuleRows ?? [{partType: inputType, name: '', fillColor: '#22c55e', relativeWeight: 100}];
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
            const route = outboundRoutes.get(input.id);
            const reservesBuffer = route?.to.type === 'buffer';
            const moving = route && !reservesBuffer;
            while (due <= timeMilliseconds && due < closes && state.count < maximum) {
                const rule = sampleInputRule(rules, random);
                const actualLength = (rule.length ?? INPUT_RULE_DEFAULT_DIMENSIONS.length) / 1000;
                const actualWidth = (rule.width ?? INPUT_RULE_DEFAULT_DIMENSIONS.width) / 1000;
                const width = input.workpieceDisplayMode === 'actual' ? actualLength : recommendedWidth;
                const height = input.workpieceDisplayMode === 'actual' ? actualWidth : recommendedHeight;
                const part = {
                    id: `workpiece-${runId}-${nextId++}`, type: 'workpiece',
                    sourceId: input.id, sourceName: getComponentLabel(input), sequence: ++state.count,
                    attachedComponentId: moving ? route.line.id : input.id,
                    status: moving ? 'moving' : 'stacked', angle: moving ? route.angle : 0,
                    partType: getInputRuleCategory(rule), packingType: inputType, name: rule.name ?? '',
                    fillColor: rule.fillColor ?? '#22c55e', borderColor: '#ff0000',
                    generatedAt: due / 1000, actualLength, actualWidth, width, height,
                    distanceTravelled: 0, lastMotionAt: due,
                    offsetX: -width, offsetY: ((input.height ?? 3) - height) / 2,
                    stackHidden: false,
                };
                workpieces.push(part);
                if (reservesBuffer) {
                    schedule({kind: 'input-transfer', part, station: input, at: Math.max(due, lastAdvancedAt)});
                } else if (!route) {
                    addToStack(part, input, 'left');
                }
                state.lastGeneratedAt = due;
                due += interval;
                changed = true;
            }
            if (state.count < maximum && due < closes) hasPendingGeneration = true;
        }

        const scheduleArrival = part => {
            const line = byId.get(part.attachedComponentId);
            const route = routesByLine.get(part.attachedComponentId);
            if (!route) return;
            const speed = line.workpieceSpeed ?? DEFAULT_WORKPIECE_SPEED;
            const remaining = Math.max(0, route.length - part.distanceTravelled);
            if (remaining > 0 && (!Number.isFinite(speed) || speed <= 0)) return;
            const at = part.lastMotionAt + (remaining > 0 ? remaining / speed * 1000 : 0);
            // 零长度连接线和零时长设备组成环时，同一时刻每条线只经过一次，避免死循环。
            let visits = instantaneousRoutes.get(part);
            if (!visits || visits.at !== at) {
                visits = {at, lines: new Set()};
                instantaneousRoutes.set(part, visits);
            }
            if (visits.lines.has(line.id)) return;
            visits.lines.add(line.id);
            schedule({kind: 'arrival', at, part, route});
        };
        const sendDownstream = (part, outgoing, at) => {
            leaveStack(part);
            part.status = 'moving';
            part.attachedComponentId = outgoing.line.id;
            part.distanceTravelled = 0;
            part.lastMotionAt = at;
            scheduleArrival(part);
        };
        const scheduleTransfer = (ownerId, at) => schedule({kind: 'transfer-ready', ownerId, at});
        const queueTransfer = (part, owner, readyAt, record) => {
            const queue = pendingTransfers.get(owner.id) ?? [];
            pendingTransfers.set(owner.id, queue);
            part.status = owner.type === 'buffer' && outboundRoutes.has(owner.id) ? 'waiting' : 'stacked';
            queue.push({part, readyAt, record});
            if (queue.length === 1) scheduleTransfer(owner.id, readyAt);
        };
        const drainTransfers = (ownerId, at) => {
            const queue = pendingTransfers.get(ownerId);
            if (!queue?.length) return;
            const owner = byId.get(ownerId);
            const outgoing = outboundRoutes.get(ownerId);
            if (!outgoing) {
                for (const {part} of queue) {
                    if (part.status !== 'stacked') changed = true;
                    part.status = 'stacked';
                }
                return;
            }
            const fromBuffer = owner.type === 'buffer';
            const toBuffer = outgoing.to.type === 'buffer';
            const speed = outgoing.line.workpieceSpeed ?? DEFAULT_WORKPIECE_SPEED;
            const capacity = toBuffer ? getBufferProperty(outgoing.to, 'bufferCapacity') : -1;
            while (queue.length) {
                const {part, readyAt, record} = queue[0];
                if (fromBuffer && part.status !== 'waiting') {
                    part.status = 'waiting';
                    changed = true;
                }
                if (readyAt > at) {
                    scheduleTransfer(ownerId, readyAt);
                    break;
                }
                // 出线停住或下游没有空位时，工件仍留在原处。
                if (fromBuffer && outgoing.length > 0 && !(speed > 0 && Number.isFinite(speed))) break;
                const visits = instantaneousRoutes.get(part);
                if (outgoing.length === 0 && visits?.at === at && visits.lines.has(outgoing.line.id)) {
                    part.status = 'stacked';
                    queue.shift();
                    changed = true;
                    continue;
                }
                const reserved = occupied.get(outgoing.to.id) ?? 0;
                if (toBuffer && capacity !== -1 && reserved >= capacity) break;
                queue.shift();
                if (toBuffer) occupied.set(outgoing.to.id, reserved + 1);
                if (fromBuffer) {
                    occupied.set(ownerId, (occupied.get(ownerId) ?? 0) - 1);
                    const upstream = inboundBufferLines.get(ownerId)?.fromId;
                    if (pendingTransfers.has(upstream)) scheduleTransfer(upstream, at);
                }
                if (record) record.departedAt = at / 1000;
                sendDownstream(part, outgoing, at);
                changed = true;
            }
            if (!queue.length) pendingTransfers.delete(ownerId);
        };
        const getInheritedRoutes = (parts, at) => {
            const inherited = new Set();
            for (const part of parts) {
                const visits = instantaneousRoutes.get(part);
                if (visits?.at === at) for (const id of visits.lines) inherited.add(id);
            }
            return inherited;
        };
        const consumeWorkpieces = parts => {
            const consumed = new Set(parts);
            for (const part of parts) leaveStack(part);
            for (let index = workpieces.length - 1; index >= 0; index--) {
                if (consumed.has(workpieces[index])) workpieces.splice(index, 1);
            }
        };
        const releaseStationProduct = (part, station, outgoing, at, inherited) => {
            Object.assign(part, {status: 'stacked', distanceTravelled: 0, lastMotionAt: at, stackHidden: false});
            workpieces.push(part);
            if (inherited.size) instantaneousRoutes.set(part, {at, lines: new Set(inherited)});
            if (outgoing && !(outgoing.length === 0 && inherited.has(outgoing.line.id))) {
                if (outgoing.to.type === 'buffer') {
                    addToStack(part, station, 'center');
                    queueTransfer(part, station, at);
                } else {
                    sendDownstream(part, outgoing, at);
                }
            } else {
                addToStack(part, station, 'center');
            }
        };
        const startAssembly = (station, state, batch, unitNumber, at) => {
            const selected = new Set(batch.parts);
            state.waiting = state.waiting.filter(part => !selected.has(part));
            const setup = Math.round(batch.recipe.setupTime * 1000);
            const assembly = Math.round(batch.recipe.assemblyTime * 1000);
            const job = {
                ...batch,
                unitNumber,
                packingType: getAssemblyPackingType(batch.recipe, station.assemblyMode),
                startedAt: at,
                assemblyStartedAt: at + setup,
                endsAt: at + (setup || assembly),
                assemblyDuration: assembly,
                preparing: setup > 0,
            };
            state.activeJobs.set(unitNumber, job);
            for (const part of job.parts) part.status = job.preparing ? 'preparing' : 'processing';
            schedule({kind: 'assembly', at: job.endsAt, station, state, job});
            changed = true;
        };
        const dispatchAssemblies = (station, state, at) => {
            const unitCount = getAssemblyUnitCount(station);
            for (let unit = 1; state.waiting.length && state.activeJobs.size < unitCount && unit <= unitCount; unit++) {
                if (state.activeJobs.has(unit)) continue;
                const batch = findAssemblyBatch(station.assemblyRecipes, state.waiting);
                if (!batch) break;
                startAssembly(station, state, batch, unit, at);
            }
        };
        const completeAssembly = (station, state, job, at) => {
            const outgoing = outboundRoutes.get(station.id);
            let width;
            let height;
            if (job.packingType === 'Workpiece') {
                const largest = job.parts.reduce((current, part) =>
                    part.actualLength * part.actualWidth > current.actualLength * current.actualWidth ? part : current);
                width = largest.actualLength;
                height = largest.actualWidth;
            } else {
                const dimensions = getDefaultWorkpieceDimensions(station);
                width = dimensions.length / 1000;
                height = dimensions.width / 1000;
            }
            const product = {
                id: `workpiece-${runId}-${nextId++}`, type: 'workpiece', packingType: job.packingType,
                sourceId: station.id, sourceName: getComponentLabel(station), sequence: ++state.count,
                partType: job.recipe.productType, name: job.recipe.name, fillColor: job.recipe.fillColor,
                borderColor: '#ff0000', generatedAt: at / 1000, actualLength: width, actualWidth: height, width, height,
                assembly: {
                    stationId: station.id, unitNumber: job.unitNumber, setupStartedAt: job.startedAt / 1000,
                    assemblyStartedAt: job.assemblyStartedAt / 1000, completedAt: at / 1000,
                    materials: job.parts.map(snapshotWorkpiece),
                },
            };
            if (CONTAINER_TYPES.includes(product.packingType)) product.contents = product.assembly.materials;
            // 零时长装配会生成新 ID，因此把当前时刻的线路访问记录传给产出件。
            const inherited = getInheritedRoutes(job.parts, at);
            consumeWorkpieces(job.parts);
            releaseStationProduct(product, station, outgoing, at, inherited);
            state.activeJobs.delete(job.unitNumber);
        };
        const unloadContainers = (station, state, at) => {
            const outgoing = outboundRoutes.get(station.id);
            state.waiting = state.waiting.filter(part => {
                if (!CONTAINER_TYPES.includes(part.packingType)) return true;
                const contents = part.contents ?? part.assembly?.materials;
                if (!contents?.length) return true;
                const inherited = getInheritedRoutes([part], at);
                for (const material of contents) {
                    releaseStationProduct({...material}, station, outgoing, at, inherited);
                }
                part.contents = [];
                part.unloadedAt = at / 1000;
                changed = true;
                return false;
            });
        };
        const dispatchDisassembly = (station, state, at) => {
            if (station.disassemblyMode === 'container') {
                unloadContainers(station, state, at);
                return;
            }
            const capacity = getDisassemblyUnitCount(station);
            for (let index = 0; index < state.waiting.length && state.activeJobs.size < capacity;) {
                const part = state.waiting[index];
                const recipe = part.packingType === 'Workpiece' ? findDisassemblyRecipe(station.disassemblyRecipes, part) : null;
                if (!recipe) {
                    index++;
                    continue;
                }
                state.waiting.splice(index, 1);
                const setup = Math.round(recipe.setupTime * 1000);
                const duration = Math.round(recipe.disassemblyTime * 1000);
                const job = {part, recipe, startedAt: at, disassemblyStartedAt: at + setup,
                    endsAt: at + (setup || duration), duration, preparing: setup > 0};
                part.status = setup ? 'preparing' : 'processing';
                state.activeJobs.add(job);
                schedule({kind: 'disassembly', at: job.endsAt, station, state, job});
                changed = true;
            }
        };
        const completeDisassembly = (station, state, job, at) => {
            const {part, recipe} = job;
            const inherited = getInheritedRoutes([part], at);
            const outgoing = outboundRoutes.get(station.id);
            const originalMaterials = part.assembly?.materials?.slice() ?? [];
            consumeWorkpieces([part]);
            // 优先继承同类型、同名称原料的实际尺寸，其余按来料部件的实际尺寸显示。
            const rows = [...recipe.materials.filter(row => row.name), ...recipe.materials.filter(row => !row.name)];
            for (const row of rows) {
                for (let index = 0; index < row.quantity; index++) {
                    const originalIndex = originalMaterials.findIndex(material =>
                        material.partType === row.partType && (!row.name || material.name === row.name));
                    const original = originalIndex < 0 ? part : originalMaterials.splice(originalIndex, 1)[0];
                    const width = original.actualLength;
                    const height = original.actualWidth;
                    const product = {
                        id: `workpiece-${runId}-${nextId++}`, type: 'workpiece', packingType: 'Workpiece',
                        sourceId: station.id, sourceName: getComponentLabel(station), sequence: ++state.count,
                        partType: row.partType, name: row.name, fillColor: row.fillColor, borderColor: '#ff0000',
                        generatedAt: at / 1000, actualLength: width, actualWidth: height, width, height,
                        disassembly: {stationId: station.id, parentId: part.id, setupStartedAt: job.startedAt / 1000,
                            startedAt: job.disassemblyStartedAt / 1000, completedAt: at / 1000},
                    };
                    releaseStationProduct(product, station, outgoing, at, inherited);
                }
            }
            state.activeJobs.delete(job);
        };
        const startNext = (station, state, equipment, at) => {
            if (!equipment.enabled || equipment.active || !state.queue.length) return;
            const part = state.queue.shift();
            equipment.active = part;
            // 每件开始准备时读取定值；本件的时长不受加工途中修改属性的影响。
            const duration = field => Math.round((isValidWorkstationProperty(field, station[field]) ?
                station[field] : WORKSTATION_PROPERTY_DEFAULTS[field]) * 1000);
            part.setupStartedAt = at / 1000;
            delete part.processingStartedAt;
            delete part.processedAt;
            part.processingDuration = duration('processingTime');
            const setupDuration = duration('setupTime');
            part.status = setupDuration > 0 ? 'preparing' : 'processing';
            part.equipmentId = equipment.id;
            part.stageEndsAt = at + (setupDuration > 0 ? setupDuration : part.processingDuration);
            if (!setupDuration) part.processingStartedAt = at / 1000;
            const history = part.processingHistory ??= [];
            const record = {
                id: `${part.id}:operation:${history.length + 1}`,
                stationId: station.id, equipmentId: equipment.id, workpieceId: part.id,
                sourceId: part.sourceId, sequence: part.sequence, partType: part.partType,
                queuedAt: part.arrivedAt, setupStartedAt: part.setupStartedAt,
                waitingTime: part.setupStartedAt - part.arrivedAt,
                setupTime: setupDuration / 1000, processingTime: part.processingDuration / 1000,
                processingStartedAt: part.processingStartedAt ?? null,
                processedAt: null, departedAt: null, status: part.status,
            };
            history.push(record);
            equipment.records.push(record);
            equipment.activeRecord = record;
            equipment.status = part.status;
            schedule({kind: 'stage', at: part.stageEndsAt, part, station, state, equipment});
            changed = true;
        };
        for (const [id, state] of workstations) {
            const station = byId.get(id);
            for (const equipment of state.equipment.values()) {
                if (equipment.active) {
                    schedule({kind: 'stage', at: equipment.active.stageEndsAt, part: equipment.active, station, state, equipment});
                } else {
                    startNext(station, state, equipment, lastAdvancedAt);
                }
            }
        }
        for (const [id, state] of assemblyStations) {
            const station = byId.get(id);
            for (const job of state.activeJobs.values()) {
                schedule({kind: 'assembly', at: job.endsAt, station, state, job});
            }
            if (state.waiting.length && state.activeJobs.size < getAssemblyUnitCount(station)) {
                schedule({kind: 'station-dispatch', at: lastAdvancedAt, station});
            }
        }
        for (const [id, state] of disassemblyStations) {
            const station = byId.get(id);
            for (const job of state.activeJobs) {
                schedule({kind: 'disassembly', at: job.endsAt, station, state, job});
            }
            if (state.waiting.length && (station.disassemblyMode === 'container' ||
                state.activeJobs.size < getDisassemblyUnitCount(station))) {
                schedule({kind: 'station-dispatch', at: lastAdvancedAt, station});
            }
        }
        for (const [id, queue] of pendingTransfers) {
            scheduleTransfer(id, Math.max(lastAdvancedAt, queue[0].readyAt));
        }
        for (const part of workpieces) if (part.status === 'moving') scheduleArrival(part);

        while (events.length) {
            const {kind, at, part, route, station, state, equipment, job, ownerId} = events.pop();
            if (kind !== 'station-dispatch' && kind !== 'transfer-ready') changed = true;
            if (kind === 'arrival') {
                const destination = route.to;
                part.distanceTravelled = route.length;
                part.lastMotionAt = at;
                part.arrivedAt = at / 1000;
                addToStack(part, destination, 'center');
                if (destination.type === 'buffer') {
                    const minimumStay = Math.round(getBufferProperty(destination, 'minimumStayTime') * 1000);
                    queueTransfer(part, destination, at + minimumStay);
                } else if (destination.type === 'disassemblyWorkstation') {
                    part.status = 'stacked';
                    let disassembly = disassemblyStations.get(destination.id);
                    if (!disassembly) {
                        disassembly = {waiting: [], activeJobs: new Set(), count: 0};
                        disassemblyStations.set(destination.id, disassembly);
                    }
                    disassembly.waiting.push(part);
                    stationDispatches.set(destination.id, destination);
                } else if (destination.type === 'assemblyWorkstation') {
                    part.status = 'stacked';
                    let assembly = assemblyStations.get(destination.id);
                    if (!assembly) {
                        assembly = {waiting: [], activeJobs: new Map(), count: 0};
                        assemblyStations.set(destination.id, assembly);
                    }
                    assembly.waiting.push(part);
                    stationDispatches.set(destination.id, destination);
                } else if (destination.type === 'workstation' || destination.type === 'parallelWorkstation') {
                    part.status = 'waiting';
                    delete part.equipmentId;
                    const device = workstations.get(destination.id);
                    device.queue.push(part);
                    for (const slot of device.equipment.values()) startNext(destination, device, slot, at);
                } else {
                    part.status = destination.type === 'systemOutput' ? 'completed' :
                        (outboundRoutes.has(destination.id) ? 'waiting' : 'stacked');
                }
            } else if (kind === 'input-transfer') {
                addToStack(part, station, 'left');
                queueTransfer(part, station, at);
            } else if (kind === 'transfer-ready') {
                transferDispatches.add(ownerId);
            } else if (kind === 'station-dispatch') {
                stationDispatches.set(station.id, station);
            } else if (kind === 'assembly') {
                if (job.preparing) {
                    job.preparing = false;
                    job.endsAt = at + job.assemblyDuration;
                    for (const material of job.parts) material.status = 'processing';
                    schedule({kind: 'assembly', at: job.endsAt, station, state, job});
                } else {
                    completeAssembly(station, state, job, at);
                    stationDispatches.set(station.id, station);
                }
            } else if (kind === 'disassembly') {
                if (job.preparing) {
                    job.preparing = false;
                    job.part.status = 'processing';
                    job.endsAt = at + job.duration;
                    schedule({kind: 'disassembly', at: job.endsAt, station, state, job});
                } else {
                    completeDisassembly(station, state, job, at);
                    stationDispatches.set(station.id, station);
                }
            } else if (part.status === 'preparing') {
                part.status = 'processing';
                part.processingStartedAt = at / 1000;
                equipment.status = 'processing';
                equipment.activeRecord.status = 'processing';
                equipment.activeRecord.processingStartedAt = part.processingStartedAt;
                part.stageEndsAt = at + part.processingDuration;
                schedule({kind: 'stage', at: part.stageEndsAt, part, station, state, equipment});
            } else {
                part.processedAt = at / 1000;
                equipment.activeRecord.processedAt = part.processedAt;
                equipment.activeRecord.status = 'completed';
                delete part.stageEndsAt;
                delete part.processingDuration;
                const outgoing = outboundRoutes.get(station.id);
                if (outgoing?.to.type === 'buffer') {
                    queueTransfer(part, station, at, equipment.activeRecord);
                } else if (outgoing) {
                    equipment.activeRecord.departedAt = at / 1000;
                    sendDownstream(part, outgoing, at);
                } else {
                    part.status = 'stacked';
                }
                equipment.active = null;
                equipment.activeRecord = null;
                equipment.status = 'idle';
                startNext(station, state, equipment, at);
            }
            // 先处理同一时刻的全部到达和完工，再分配装配、拆卸单元。
            if (events.nextAt - at > ASSEMBLY_TIME_TOLERANCE_MS) {
                for (const destination of stationDispatches.values()) {
                    if (destination.type === 'assemblyWorkstation') {
                        dispatchAssemblies(destination, assemblyStations.get(destination.id), at);
                    } else {
                        dispatchDisassembly(destination, disassemblyStations.get(destination.id), at);
                    }
                }
                stationDispatches.clear();
                for (const ownerId of transferDispatches) drainTransfers(ownerId, at);
                transferDispatches.clear();
            }
        }
        // 只累计各段实际行驶的时间，准备和加工结束后的剩余帧时间可继续走下一段。
        for (const part of workpieces) {
            if (part.status !== 'moving') continue;
            const speed = byId.get(part.attachedComponentId)?.workpieceSpeed ?? DEFAULT_WORKPIECE_SPEED;
            const distance = Number.isFinite(speed) && speed > 0 ? speed * Math.max(0, timeMilliseconds - part.lastMotionAt) / 1000 : 0;
            if (distance > 0) changed = true;
            part.distanceTravelled += distance;
            part.lastMotionAt = timeMilliseconds;
        }
        lastAdvancedAt = timeMilliseconds;
        return syncAttachments(components) || changed;
    }

    // 返回副本，后续统计界面可以按站、设备和工件查询，不能反向修改仿真运行状态。
    function getEquipmentStates(stationId) {
        return [...workstations].filter(([id]) => stationId === undefined || stationId === id)
            .flatMap(([id, state]) => [...state.equipment.values()].map(equipment => ({
                stationId: id, equipmentId: equipment.id, enabled: equipment.enabled,
                status: equipment.status, workpieceId: equipment.active?.id ?? null,
                records: equipment.records.map(record => ({...record})),
            })));
    }

    return {workpieces, advanceTo, syncAttachments, isComplete, reset, getEquipmentStates};
}

// 最小堆保证事件按时间执行；同一时刻按入队顺序执行，保持先到先服务。
function createEventQueue() {
    const heap = [];
    let sequence = 0;
    const before = (a, b) => a.at < b.at || (a.at === b.at && a.order < b.order);
    return {
        get length() { return heap.length; },
        get nextAt() { return heap[0]?.at ?? Infinity; },
        push(event) {
            event.order = sequence++;
            let index = heap.length;
            heap.push(event);
            while (index > 0) {
                const parent = Math.floor((index - 1) / 2);
                if (!before(event, heap[parent])) break;
                heap[index] = heap[parent];
                index = parent;
            }
            heap[index] = event;
        },
        pop() {
            const first = heap[0];
            const last = heap.pop();
            if (heap.length) {
                let index = 0;
                while (index * 2 + 1 < heap.length) {
                    let child = index * 2 + 1;
                    if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
                    if (!before(heap[child], last)) break;
                    heap[index] = heap[child];
                    index = child;
                }
                heap[index] = last;
            }
            return first;
        },
    };
}
