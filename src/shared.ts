export const ID = "com.tokenmove.ab";
export const COMMAND = `${ID}/command`;
export const STATE = `${ID}/state`;
export type Point = {x: number; y: number};
export type Mode = "once" | "patrol";
export const VERSION = "2.8.0";
export type Facing = "right" | "left";
export type Movement = "line" | "stationary";
export type PauseEffect = "inherit" | "none" | "wiggle" | "shake";
export type Effect = "none" | "shake" | "wiggle";
// Optional additions keep existing version-3 scene data and old command senders compatible.
export interface Settings {speed: number; mode: Mode; smooth: boolean; flip: boolean; facing: Facing; movement?: Movement; effect?: Effect; shakeDistance?: number; wiggleAngle?: number; effectSpeed?: number; waypointPauses?: number[]; waypointEffects?: PauseEffect[]}
export interface Anchor {id: string; name: string; type: string; position: Point; scale: Point}
export interface GroupConfig {id: string; name: string; anchors: Anchor[]; route?: Point[]; settings: Settings}
export interface GroupView {id: string; name: string; count: number; names: string[]; route?: Point[]; waypointIndex?: number; pauseRemaining?: number; settings: Settings; running: boolean; progress: number; direction: "outbound" | "return"; message: string}
export interface State {version: string; gridDpi?: number; ready: boolean; gm: boolean; groups: GroupView[]; selectedId?: string; pickingId?: string; pickMode?: "start" | "line"; draft?: Point[]; routeVisible?: boolean; message: string; lastRequest?: string; error?: string}
export type Command =
  | {type: "status" | "stopAll" | "startAll"}
  | {type: "create"}
  | {type: "select" | "capture" | "pickStart" | "pickLine" | "finishLine" | "undoLine" | "cancelPick" | "showRoute" | "stop" | "reset" | "remove" | "start"; id: string}
  | {type: "update"; id: string; name: string; settings: Settings};
export interface CommandMessage {request: string; command: Command}
export const defaultSettings: Settings = {speed: 2, mode: "patrol", smooth: false, flip: true, facing: "right", movement:"line", effect:"none", shakeDistance:.04, wiggleAngle:8, effectSpeed:1};
export function normalizedSettings(s:Settings){return {...s,movement:s.movement??"line",effect:s.effect??"none",shakeDistance:s.shakeDistance??.04,wiggleAngle:s.wiggleAngle??8,effectSpeed:s.effectSpeed??1};}
export const initialState: State = {version: VERSION, ready: false, gm: false, groups: [], message: "กำลังเชื่อมต่อ Owlbear Rodeo…"};
export function positionAt(a: Point, b: Point, t: number, smooth: boolean): Point {
  const p = Math.max(0, Math.min(1, t));
  const f = smooth ? p * p * (3 - 2 * p) : p;
  return {x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f};
}
export function finitePoint(value: unknown): value is Point {
  const p = value as Point | null;
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}
export function validSettings(s: Settings): boolean {
  const range=(n:number|undefined,min:number,max:number)=>n===undefined||(Number.isFinite(n)&&n>=min&&n<=max);
  return !!s && Number.isFinite(s.speed) && s.speed >= .1 && s.speed <= 20 && ["once", "patrol"].includes(s.mode) && typeof s.smooth === "boolean" && typeof s.flip === "boolean" && ["left", "right"].includes(s.facing) && (s.movement===undefined||["line","stationary"].includes(s.movement)) && (s.effect===undefined||["none","shake","wiggle"].includes(s.effect)) && range(s.shakeDistance,.005,.25) && range(s.wiggleAngle,1,30) && range(s.effectSpeed,.25,3) && (s.waypointPauses===undefined||(Array.isArray(s.waypointPauses)&&s.waypointPauses.length<=501&&s.waypointPauses.every(n=>Number.isFinite(n)&&n>=0&&n<=3600))) && (s.waypointEffects===undefined||(Array.isArray(s.waypointEffects)&&s.waypointEffects.length<=501&&s.waypointEffects.every(e=>["inherit","none","wiggle","shake"].includes(e))));
}
export function validateConfig(value: unknown): value is GroupConfig {
  const g = value as GroupConfig | null;
  return !!g && typeof g.id === "string" && g.id.length > 0 && typeof g.name === "string" && g.name.length <= 80 && validSettings(g.settings) && (g.route === undefined || (Array.isArray(g.route) && g.route.length >= 2 && g.route.length <= 501 && g.route.every(finitePoint) && g.route.every((p,i)=>i===0||Math.hypot(p.x-g.route![i-1].x,p.y-g.route![i-1].y)>.01))) && Array.isArray(g.anchors) && new Set(g.anchors.map(a => a?.id)).size === g.anchors.length && g.anchors.every(a => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.type === "string" && finitePoint(a.position) && finitePoint(a.scale));
}
// Packets stay below the SDK's 16 KB broadcast limit, including Thai text.
export interface StatePacket {transfer: string; index: number; total: number; data: string}
export function statePackets(state: State): StatePacket[] {
  const json = JSON.stringify(state); const transfer = crypto.randomUUID();
  const total = Math.ceil(json.length / 2800);
  return Array.from({length: total}, (_, index) => ({transfer, index, total, data: json.slice(index * 2800, (index + 1) * 2800)}));
}
export function durationMs(a: Point, b: Point, dpi: number, speed: number) {
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 20) throw new Error("ความเร็วต้องอยู่ระหว่าง 0.1 ถึง 20 ช่อง/วินาที");
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error("ไม่สามารถอ่านขนาดกริดได้");
  return Math.max(100, Math.hypot(b.x - a.x, b.y - a.y) / dpi / speed * 1000);
}
