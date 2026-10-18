import type {Item} from "@owlbear-rodeo/sdk";
import {durationMs, positionAt, type Point, type Anchor, type Facing} from "./shared";

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
  private flip = false;
  private facing: Facing = "right";
  private scales: Point[] = [];
  private routeStarted = false;
  get direction(): "outbound" | "return" {return this.goingHome ? "return" : "outbound";}
  running = false;
  progress = 0;
  constructor(private adapter: MotionAdapter) {}

  async start(originals: Anchor[], b: Point, dpi: number, speed: number, patrol: boolean, smooth: boolean, now: number, options = {flip: false, facing: "right" as Facing, resume: false}) {
    if (!originals.length) throw new Error("กรุณาบันทึกจุด A ก่อน");
    await this.stop();
    const fresh = await this.adapter.read(originals.map(i => i.id));
    if (fresh.length !== originals.length || fresh.some(i => i.locked || i.attachedTo)) throw new Error("วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น กรุณาเลือกจุด A ใหม่");
    this.latest = originals.map(o => fresh.find(i => i.id === o.id)!);
    this.home = originals.map(i => ({...i.position}));
    const delta = {x: b.x - originals[0].position.x, y: b.y - originals[0].position.y};
    this.away = originals.map(i => ({x: i.position.x + delta.x, y: i.position.y + delta.y}));
    this.dpi = dpi; this.speed = speed; this.patrol = patrol; this.smooth = smooth;
    if (!patrol || !options.resume || !this.routeStarted) this.goingHome = false;
    this.flip = options.flip; this.facing = options.facing;
    this.scales = this.latest.map((item,i) => ({x: Math.abs(item.scale.x) * (Math.sign(originals[i].scale.x) || 1), y: item.scale.y}));
    // Validate before opening an interaction.
    durationMs(this.latest[0].position, this.away[0], dpi, speed);
    this.beginLeg(now);
    this.interaction = await this.adapter.interact(this.latest);
    this.renewed = now; this.running = true; this.progress = 0; this.routeStarted = true;
    this.apply(0);
  }
  private apply(t: number) {
    if (!this.interaction) return;
    this.latest = this.interaction[0](draft => draft.forEach((item, i) => {
      item.position = positionAt(this.from[i], this.target[i], t, this.smooth);
      if (this.flip && item.type === "IMAGE") {
        const dx = this.target[i].x - this.from[i].x;
        // Horizontal routes face the direction of travel. Vertical routes flip on return.
        const sign = Math.abs(dx) > .01 ? (dx > 0 ? 1 : -1) * (this.facing === "right" ? 1 : -1) : Math.sign(this.scales[i].x) * (this.goingHome ? -1 : 1);
        item.scale = {x: Math.abs(this.scales[i].x) * sign, y: this.scales[i].y};
      }
    }));
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
      const fresh = await this.adapter.read(this.latest.map(i => i.id));
      if (fresh.length !== this.latest.length || fresh.some(i => i.locked || i.attachedTo)) throw new Error("หยุดแล้ว: วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น");
      this.interaction[1](); this.interaction = undefined;
      await this.adapter.commit(this.latest);
      // getItems need not return items in the requested order.
      const ordered = this.latest.map(item => ({...fresh.find(i => i.id === item.id)!, position: {...item.position}, scale: {...item.scale}}));
      this.interaction = await this.adapter.interact(ordered); this.renewed = now;
    }
    this.progress = Math.min(1, Math.max(0, (now - this.started) / this.duration));
    this.apply(this.progress);
    if (this.progress >= 1) {
      if (!this.patrol) await this.stop();
      else {this.goingHome = !this.goingHome; this.beginLeg(now); this.progress = 0; this.apply(0);}
    }
  }
  async stop(commit = true) {
    const wasRunning = this.running;
    this.running = false;
    this.interaction?.[1](); this.interaction = undefined;
    if (commit && wasRunning) await this.adapter.commit(this.latest);
  }
}
