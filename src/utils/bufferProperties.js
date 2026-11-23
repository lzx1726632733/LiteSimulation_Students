export const BUFFER_PROPERTY_DEFAULTS = {
    bufferCapacity: -1,
    minimumStayTime: 0,
};

export function isValidBufferProperty(field, value) {
    if (field === 'bufferCapacity') return Number.isSafeInteger(value) && (value === -1 || value > 0);
    return field === 'minimumStayTime' && Number.isFinite(value) && value >= 0 &&
        Number.isSafeInteger(Math.round(value * 1000));
}

export function getBufferProperty(buffer, field) {
    return isValidBufferProperty(field, buffer?.[field]) ? buffer[field] : BUFFER_PROPERTY_DEFAULTS[field];
}
