import type {Item} from "@owlbear-rodeo/sdk";
import {durationMs, positionAt, type Point} from "./shared";

type Interaction = [(recipe: (draft: Item[]) => void) => Item[], () => void];
export interface MotionAdapter {
  read(ids: string[]): Promise<Item[]>;
  interact(items: Item[]): Promise<Interaction>;
  commit(items: Item[]): Promise<void>;
}
/** All public methods are serialized by the background queue. */
export class Motion {
  private interaction?: Interaction;
  private latest: Item[] = [];
  private from: Point[] = [];
  private target: Point[] = [];
  private home: Point[] = [];
  private away: Point[] = [];
  private started = 0;
  private renewed = 0;
  private duration = 0;
  private speed = 1;
  private dpi = 150;
  private smooth = false;
  private patrol = false;
  private goingHome = false;
  running = false;
  progress = 0;
  constructor(private adapter: MotionAdapter) {}

  async start(originals: Item[], b: Point, dpi: number, speed: number, patrol: boolean, smooth: boolean, now: number) {
    await this.stop();
    const fresh = await this.adapter.read(originals.map(i => i.id));
    if (fresh.length !== originals.length || fresh.some(i => i.locked)) throw new Error("วัตถุถูกลบหรือล็อก กรุณาเลือกจุด A ใหม่");
    this.latest = originals.map(o => fresh.find(i => i.id === o.id)!);
    this.home = originals.map(i => ({...i.position}));
    const delta = {x: b.x - originals[0].position.x, y: b.y - originals[0].position.y};
    this.away = originals.map(i => ({x: i.position.x + delta.x, y: i.position.y + delta.y}));
    this.dpi = dpi; this.speed = speed; this.patrol = patrol; this.smooth = smooth; this.goingHome = false;
    // Validate before opening an interaction.
    durationMs(this.latest[0].position, this.away[0], dpi, speed);
    this.beginLeg(now);
    this.interaction = await this.adapter.interact(this.latest);
    this.renewed = now; this.running = true; this.progress = 0;
  }
  private beginLeg(now: number) {
    this.from = this.latest.map(i => ({...i.position}));
    this.target = this.goingHome ? this.home : this.away;
    this.duration = Math.max(...this.from.map((p, i) => durationMs(p, this.target[i], this.dpi, this.speed)));
    this.started = now;
  }
  async tick(now: number) {
    if (!this.running || !this.interaction) return;
    // SDK interactions expire at 30 seconds; commit and renew before that limit.
    if (now - this.renewed >= 20_000) {
      this.interaction[1](); this.interaction = undefined;
      await this.adapter.commit(this.latest);
      const fresh = await this.adapter.read(this.latest.map(i => i.id));
      if (fresh.length !== this.latest.length || fresh.some(i => i.locked)) throw new Error("หยุดแล้ว: วัตถุถูกลบหรือล็อก");
      // getItems need not return items in the requested order.
      const ordered = this.latest.map(item => fresh.find(i => i.id === item.id)!);
      this.interaction = await this.adapter.interact(ordered); this.renewed = now;
    }
    this.progress = Math.min(1, Math.max(0, (now - this.started) / this.duration));
    this.latest = this.interaction[0](draft => draft.forEach((item, i) => {
      item.position = positionAt(this.from[i], this.target[i], this.progress, this.smooth);
    }));
    if (this.progress >= 1) {
      if (!this.patrol) await this.stop();
      else {this.goingHome = !this.goingHome; this.beginLeg(now);}
    }
  }
  async stop(commit = true) {
    const wasRunning = this.running;
    this.running = false;
    this.interaction?.[1](); this.interaction = undefined;
    if (commit && wasRunning) await this.adapter.commit(this.latest);
  }
}
