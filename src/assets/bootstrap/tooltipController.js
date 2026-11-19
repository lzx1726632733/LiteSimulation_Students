const TOOLTIP_DELAY_MS = 500

/**
 * Creates one shared Bootstrap tooltip directive for a group of Vue elements.
 * A cold hover must remain stationary on the same element for the full delay.
 * After one tooltip has shown, adjacent targets can show immediately for a
 * short session that expires after the pointer leaves the targets.
 */
export function createBootstrapTooltipDirective() {
    const tooltipInstances = new WeakMap()
    const tooltipHandlers = new WeakMap()

    let hoveredElement = null
    let focusedElement = null
    let shownElement = null
    let showTimer = null
    let graceTimer = null
    let graceGeneration = 0
    let graceRemainingMs = 0
    let leftAt = 0
    let lastPointerPosition = null
    let lastInputWasPointer = false
    let mountedCount = 0

    function clearShowTimer() {
        if (showTimer !== null) {
            window.clearTimeout(showTimer)
            showTimer = null
        }
        lastPointerPosition = null
    }

    function clearGraceTimer() {
        graceGeneration += 1
        if (graceTimer !== null) {
            window.clearTimeout(graceTimer)
            graceTimer = null
        }
    }

    function hideTooltip(element, force = false) {
        if (!element || shownElement !== element) return
        if (!force && (hoveredElement === element || focusedElement === element)) return
        tooltipInstances.get(element)?.hide()
        shownElement = null
    }

    function showTooltip(element, firstShow = false) {
        if (!element || shownElement === element) return
        if (shownElement) hideTooltip(shownElement, true)
        tooltipInstances.get(element)?.show()
        shownElement = element
        if (firstShow) graceRemainingMs = TOOLTIP_DELAY_MS
    }

    function resumeGracePeriod() {
        const now = performance.now()
        if (leftAt !== 0) {
            graceRemainingMs = Math.max(0, graceRemainingMs - (now - leftAt))
            leftAt = 0
        }
        clearGraceTimer()
        if (graceRemainingMs > 0) graceRemainingMs = TOOLTIP_DELAY_MS
        return graceRemainingMs > 0
    }

    function startGracePeriodDrain() {
        if (graceRemainingMs <= 0 || leftAt !== 0) return

        leftAt = performance.now()
        clearGraceTimer()
        const generation = graceGeneration
        graceTimer = window.setTimeout(() => {
            if (generation !== graceGeneration) return
            graceTimer = null
            if (hoveredElement || focusedElement) return
            graceRemainingMs = 0
            leftAt = 0
        }, Math.ceil(graceRemainingMs))
    }

    function scheduleStationaryShow(element, event) {
        clearShowTimer()
        lastPointerPosition = {x: event.clientX, y: event.clientY}
        showTimer = window.setTimeout(() => {
            showTimer = null
            lastPointerPosition = null
            if (hoveredElement === element && graceRemainingMs === 0) showTooltip(element, true)
        }, TOOLTIP_DELAY_MS)
    }

    function onPointerEnter(element, event) {
        hoveredElement = element
        if (resumeGracePeriod()) {
            clearShowTimer()
            showTooltip(element)
            return
        }
        scheduleStationaryShow(element, event)
    }

    function onPointerMove(element, event) {
        if (hoveredElement !== element || graceRemainingMs > 0 || shownElement === element) return

        const moved = !lastPointerPosition
            || event.clientX !== lastPointerPosition.x
            || event.clientY !== lastPointerPosition.y
        if (moved) scheduleStationaryShow(element, event)
    }

    function onPointerLeave(element) {
        if (hoveredElement === element) hoveredElement = null
        clearShowTimer()
        if (focusedElement === element) return

        hideTooltip(element)
        // Before the first tooltip appears, leaving any target cancels the cold wait.
        // Only a previously shown tooltip starts the fast-switch grace period.
        startGracePeriodDrain()
    }

    function onFocusIn(element) {
        if (lastInputWasPointer) return
        focusedElement = element
        clearShowTimer()
        const isWarm = resumeGracePeriod()
        showTooltip(element, !isWarm)
    }

    function onFocusOut(element, event) {
        if (event.relatedTarget && element.contains(event.relatedTarget)) return
        if (focusedElement === element) focusedElement = null
        if (hoveredElement) return

        hideTooltip(element)
        startGracePeriodDrain()
    }

    function onDocumentPointerDown() {
        lastInputWasPointer = true
        if (!focusedElement) return
        const previousFocusedElement = focusedElement
        focusedElement = null
        if (hoveredElement !== previousFocusedElement) hideTooltip(previousFocusedElement)
        if (!hoveredElement) startGracePeriodDrain()
    }

    function onDocumentKeyDown() {
        lastInputWasPointer = false
    }

    function cleanupElement(element) {
        const handlers = tooltipHandlers.get(element)
        if (handlers) {
            element.removeEventListener('mouseenter', handlers.enter)
            element.removeEventListener('mouseleave', handlers.leave)
            element.removeEventListener('mousemove', handlers.move)
            element.removeEventListener('focusin', handlers.focusIn)
            element.removeEventListener('focusout', handlers.focusOut)
        }

        if (hoveredElement === element) {
            hoveredElement = null
            clearShowTimer()
        }
        if (focusedElement === element) focusedElement = null
        hideTooltip(element, true)
        tooltipInstances.get(element)?.dispose()
        tooltipInstances.delete(element)
        tooltipHandlers.delete(element)
        startGracePeriodDrain()

        mountedCount -= 1
        if (mountedCount === 0) {
            document.removeEventListener('pointerdown', onDocumentPointerDown, true)
            document.removeEventListener('keydown', onDocumentKeyDown, true)
            clearShowTimer()
            clearGraceTimer()
        }
    }

    return {
        mounted(element) {
            const tooltip = window.bootstrap?.Tooltip.getOrCreateInstance(element, {
                placement: 'top',
                trigger: 'manual',
                animation: true,
                container: 'body'
            })
            if (!tooltip) return

            if (mountedCount === 0) {
                document.addEventListener('pointerdown', onDocumentPointerDown, true)
                document.addEventListener('keydown', onDocumentKeyDown, true)
            }
            mountedCount += 1
            tooltipInstances.set(element, tooltip)
            const handlers = {
                enter: event => onPointerEnter(element, event),
                leave: () => onPointerLeave(element),
                move: event => onPointerMove(element, event),
                focusIn: () => onFocusIn(element),
                focusOut: event => onFocusOut(element, event)
            }
            tooltipHandlers.set(element, handlers)
            element.addEventListener('mouseenter', handlers.enter)
            element.addEventListener('mouseleave', handlers.leave)
            element.addEventListener('mousemove', handlers.move)
            element.addEventListener('focusin', handlers.focusIn)
            element.addEventListener('focusout', handlers.focusOut)
        },
        beforeUnmount(element) {
            cleanupElement(element)
        }
    }
}
