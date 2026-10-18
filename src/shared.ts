export const ID = "com.tokenmove.ab";
export const COMMAND = `${ID}/command`;
export const STATE = `${ID}/state`;
export type Point = {x: number; y: number};
export type Mode = "once" | "patrol";
export type Command = {type: "status" | "capture" | "pick" | "stop" | "reset"} | {type: "start"; speed: number; mode: Mode; smooth: boolean};
export interface State {ready: boolean; gm: boolean; names: string[]; a?: Point; b?: Point; picking: boolean; running: boolean; progress: number; message: string}
export const initialState: State = {ready: false, gm: false, names: [], picking: false, running: false, progress: 0, message: "กำลังเชื่อมต่อ Owlbear Rodeo…"};
export function positionAt(a: Point, b: Point, t: number, smooth: boolean): Point {
  const p = Math.max(0, Math.min(1, t));
  const f = smooth ? p * p * (3 - 2 * p) : p;
  return {x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f};
}
export function durationMs(a: Point, b: Point, dpi: number, speed: number) {
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 20) throw new Error("ความเร็วต้องอยู่ระหว่าง 0.1 ถึง 20 ช่อง/วินาที");
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error("ไม่สามารถอ่านขนาดกริดได้");
  return Math.max(100, Math.hypot(b.x - a.x, b.y - a.y) / dpi / speed * 1000);
}
