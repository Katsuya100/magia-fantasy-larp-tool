// The single timing control for overlapping combat visuals and queued inputs.
// At 0.7, the next visual phase or buffered action may advance after 70%.
export const COMBAT_FX_ADVANCE_RATIO=0.7;
export const combatFxAdvanceDelay=duration=>Math.ceil(Math.max(0,duration)*COMBAT_FX_ADVANCE_RATIO);
