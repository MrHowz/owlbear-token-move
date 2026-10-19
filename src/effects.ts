import type {Effect} from "./shared";

export interface EffectOptions {effect:Effect;shakeDistance:number;wiggleAngle:number;effectSpeed:number}
export const noEffect:EffectOptions={effect:"none",shakeDistance:.04,wiggleAngle:8,effectSpeed:1};
/** Absolute offsets from a clean pose: frame rate, corners and renewals cannot accumulate drift. */
export function effectOffset(options:EffectOptions,elapsedMs:number,dpi:number){
  const t=Math.max(0,elapsedMs)/1000*options.effectSpeed;
  if(options.effect==="wiggle")return {x:0,y:0,rotation:Math.sin(t*Math.PI*3)*options.wiggleAngle};
  if(options.effect==="shake")return {x:Math.sin(t*Math.PI*14)*dpi*options.shakeDistance,y:Math.sin(t*Math.PI*22)*dpi*options.shakeDistance*.65,rotation:0};
  return {x:0,y:0,rotation:0};
}
