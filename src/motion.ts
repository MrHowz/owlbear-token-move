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
  private stops: Point[][] = [];
  private targetIndex = 1;
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
  get waypointIndex() {return this.targetIndex;}
  running = false;
  progress = 0;
  constructor(private adapter: MotionAdapter) {}

  async start(originals: Anchor[], b: Point, dpi: number, speed: number, patrol: boolean, smooth: boolean, now: number, options: {flip:boolean;facing:Facing;resume:boolean;waypoints?:Point[]} = {flip:false,facing:"right",resume:false}) {
    if (!originals.length) throw new Error("กรุณาบันทึกจุด A ก่อน");
    await this.stop();
    const fresh = await this.adapter.read(originals.map(i => i.id));
    if (fresh.length !== originals.length || fresh.some(i => i.locked || i.attachedTo)) throw new Error("วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น กรุณาเลือกจุด A ใหม่");
    this.latest = originals.map(o => fresh.find(i => i.id === o.id)!);
    const points=options.waypoints?.length?options.waypoints:[b];
    this.stops=[originals.map(i=>({...i.position})),...points.map(point=>originals.map(i=>({x:i.position.x+point.x-originals[0].position.x,y:i.position.y+point.y-originals[0].position.y})))];
    this.dpi = dpi; this.speed = speed; this.patrol = patrol; this.smooth = smooth;
    if (!options.resume || !this.routeStarted) {this.goingHome=false;this.targetIndex=1;}
    if (!patrol && this.goingHome) {
      // A one-way route continues from the paused cell toward the next outward stop.
      this.goingHome=false;this.targetIndex=Math.min(this.stops.length-1,this.targetIndex+1);
    }
    this.targetIndex=Math.max(0,Math.min(this.stops.length-1,this.targetIndex));
    this.flip = options.flip; this.facing = options.facing;
    this.scales = this.latest.map((item,i) => ({x: Math.abs(item.scale.x) * (Math.sign(originals[i].scale.x) || 1), y: item.scale.y}));
    // Validate before opening an interaction.
    durationMs(this.latest[0].position, this.stops[this.targetIndex][0], dpi, speed);
    this.beginLeg(now);
    this.interaction = await this.adapter.interact(this.latest);
    this.renewed = now; this.running = true; this.routeStarted = true;
    this.setProgress(0);
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
    this.target = this.stops[this.targetIndex];
    this.duration = Math.max(...this.from.map((p, i) => durationMs(p, this.target[i], this.dpi, this.speed)));
    this.started = now;
  }
  private setProgress(t:number) {
    const legs=this.stops.length-1;
    this.progress=((this.goingHome?legs-1-this.targetIndex:this.targetIndex-1)+t)/legs;
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
    // Consume overshoot so short cells and corners do not reduce the chosen speed.
    for(let crossed=0;crossed<1000;crossed++) {
      const t=Math.min(1,Math.max(0,(now-this.started)/this.duration));
      this.setProgress(t);this.apply(t);
      if(t<1)return;
      const arrived=this.started+this.duration;
      if(!this.goingHome&&this.targetIndex===this.stops.length-1) {
        if(!this.patrol){await this.stop();return;}
        this.goingHome=true;
      } else if(this.goingHome&&this.targetIndex===0) this.goingHome=false;
      this.targetIndex+=this.goingHome?-1:1;
      this.beginLeg(arrived);this.setProgress(0);this.apply(0);
      // Skip complete cycles after a long browser suspension without shortcutting corners.
      if(this.patrol&&(this.targetIndex===1&&!this.goingHome)) {
        const cycle=2*this.stops.slice(1).reduce((sum,stop,i)=>sum+Math.max(...stop.map((p,j)=>durationMs(this.stops[i][j],p,this.dpi,this.speed))),0);
        if(now-this.started>=cycle)this.started+=Math.floor((now-this.started)/cycle)*cycle;
      }
    }
    // A very long route after suspension resumes at the current cell on the next frame.
    this.started=now;
  }
  async stop(commit = true) {
    const wasRunning = this.running;
    this.running = false;
    this.interaction?.[1](); this.interaction = undefined;
    if (commit && wasRunning) await this.adapter.commit(this.latest);
  }
}
