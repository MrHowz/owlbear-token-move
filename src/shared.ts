export const ID = "com.tokenmove.ab";
export const COMMAND = `${ID}/command`;
export const STATE = `${ID}/state`;
export type Point = {x: number; y: number};
export type Mode = "once" | "patrol";
export const VERSION = "2.1.1";
export type Facing = "right" | "left";
export interface Settings {speed: number; mode: Mode; smooth: boolean; flip: boolean; facing: Facing}
export interface Anchor {id: string; name: string; type: string; position: Point; scale: Point}
export interface GroupConfig {id: string; name: string; anchors: Anchor[]; b?: Point; route?: Point[]; settings: Settings}
export interface GroupView {id: string; name: string; count: number; names: string[]; a?: Point; b?: Point; route?: Point[]; waypointIndex?: number; settings: Settings; running: boolean; progress: number; direction: "outbound" | "return"; message: string}
export interface State {version: string; ready: boolean; gm: boolean; groups: GroupView[]; selectedId?: string; pickingId?: string; pickMode?: "destination" | "line"; draft?: Point[]; routeVisible?: boolean; message: string; lastRequest?: string}
export type Command =
  | {type: "status" | "stopAll" | "startAll"}
  | {type: "create"; capture: boolean}
  | {type: "select" | "capture" | "pick" | "pickLine" | "finishLine" | "undoLine" | "cancelPick" | "showRoute" | "destinationFromSelection" | "stop" | "reset" | "remove" | "start"; id: string}
  | {type: "update"; id: string; name: string; settings: Settings};
export interface CommandMessage {request: string; command: Command}
export const defaultSettings: Settings = {speed: 2, mode: "patrol", smooth: false, flip: true, facing: "right"};
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
  return !!s && Number.isFinite(s.speed) && s.speed >= .1 && s.speed <= 20 && ["once", "patrol"].includes(s.mode) && typeof s.smooth === "boolean" && typeof s.flip === "boolean" && ["left", "right"].includes(s.facing);
}
export function validateConfig(value: unknown): value is GroupConfig {
  const g = value as GroupConfig | null;
  return !!g && typeof g.id === "string" && g.id.length > 0 && typeof g.name === "string" && g.name.length <= 80 && validSettings(g.settings) && (!g.b || finitePoint(g.b)) && (g.route === undefined || (Array.isArray(g.route) && g.route.length > 0 && g.route.length <= 500 && g.route.every(finitePoint) && !!g.b && Math.hypot(g.route[g.route.length-1].x-g.b.x,g.route[g.route.length-1].y-g.b.y)<.01)) && Array.isArray(g.anchors) && new Set(g.anchors.map(a => a?.id)).size === g.anchors.length && g.anchors.every(a => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.type === "string" && finitePoint(a.position) && finitePoint(a.scale));
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
