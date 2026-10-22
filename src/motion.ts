import type {Item} from "@owlbear-rodeo/sdk";
import {durationMs, positionAt, type Point, type Anchor, type Facing, type PauseEffect} from "./shared";
import {effectOffset,noEffect,type EffectOptions} from "./effects";

type Interaction = [(recipe: (draft: Item[]) => void) => Item[], () => void];
export interface MotionAdapter {
  read(ids: string[]): Promise<Item[]>;
  interact(items: Item[]): Promise<Interaction>;
  commit(items: Item[]): Promise<void>;
  edit?(ids:string[],recipe:(items:Item[])=>void):Promise<void>;
}
/** Frame updates stay synchronous until a final commit; maintenance never blocks frames. */
export class Motion {
  private interaction?: Interaction;
  private latest: Item[] = [];
  private basePositions:Point[]=[];
  private rotations:number[]=[];
  private effect:EffectOptions={...noEffect};
  private effectStarted=0;
  private stationary=false;
  private pauses:number[]=[];
  private pauseEffects:PauseEffect[]=[];
  private hasWiggle=false;
  private waitUntil?:number;
  private savedPause=0;
  private lastTick=0;
  get pauseRemaining(){return this.running&&this.waitUntil!==undefined?Math.max(0,this.waitUntil-this.lastTick)/1000:0;}
  get completed(){return !this.running&&this.progress>=1&&this.savedPause===0;}
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
  private generation=0;
  private renewal?:Promise<void>;
  private replacement?:Interaction;
  private commits:Promise<void>=Promise.resolve();
  private maintenanceError?:Error;
  get revision(){return this.generation;}
  get direction(): "outbound" | "return" {return this.goingHome ? "return" : "outbound";}
  get waypointIndex() {return this.targetIndex;}
  running = false;
  progress = 0;
  constructor(private adapter: MotionAdapter,private clock?:()=>number) {}

  private persist(items:Item[],generation:number) {
    const snapshot=structuredClone(items);
    const write=this.commits.catch(()=>{}).then(async()=>{
      if(this.generation===generation)await this.adapter.commit(snapshot);
    });
    this.commits=write;return write;
  }
  private renew() {
    const generation=this.generation;
    const current=()=>this.running&&this.generation===generation;
    const task=(async()=>{
      const fresh=await this.adapter.read(this.latest.map(i=>i.id));
      if(!current())return;
      if(fresh.length!==this.latest.length||fresh.some(i=>i.locked||i.attachedTo))throw new Error("หยุดแล้ว: วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น");
      // Keep the old interaction moving throughout checkpoint and replacement RPCs.
      await this.persist(this.cleanPose(),generation);
      if(!current())return;
      const byId=new Map(fresh.map(i=>[i.id,i]));
      const base=this.latest.map(i=>({...byId.get(i.id)!,position:{...i.position},scale:{...i.scale},rotation:i.rotation}));
      const next=await this.adapter.interact(base);
      if(!current()){next[1]();return;}
      this.replacement=next;
    })().catch(error=>{
      if(current())this.maintenanceError=error instanceof Error?error:new Error("ต่ออายุการเคลื่อนที่ไม่สำเร็จ");
    });
    this.renewal=task;
    void task.finally(()=>{if(this.renewal===task)this.renewal=undefined;});
  }
  /** Await I/O only for lifecycle coordination or diagnostics, never for frame scheduling. */
  async waitForMaintenance(){await this.renewal;await this.commits;}

  async start(originals: Anchor[], b: Point, dpi: number, speed: number, patrol: boolean, smooth: boolean, now: number, options: {flip:boolean;facing:Facing;resume:boolean;waypoints?:Point[];stationary?:boolean;effect?:EffectOptions;waypointPauses?:number[];waypointEffects?:PauseEffect[]} = {flip:false,facing:"right",resume:false}) {
    if (!originals.length) throw new Error("เลือก Token ให้กลุ่มก่อน");
    const stopped=this.stop(),generation=this.generation;
    await stopped;
    if(this.generation!==generation)throw new Error("ยกเลิกการเริ่มเดินแล้ว");
    const fresh = await this.adapter.read(originals.map(i => i.id));
    if(this.generation!==generation)throw new Error("ยกเลิกการเริ่มเดินแล้ว");
    if (fresh.length !== originals.length || fresh.some(i => i.locked || i.attachedTo)) throw new Error("วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น กรุณาเลือก Token ใหม่");
    this.latest = originals.map(o => fresh.find(i => i.id === o.id)!);
    this.basePositions=this.latest.map(i=>({...i.position}));
    this.rotations=this.latest.map(i=>Number.isFinite(i.rotation)?i.rotation:0);
    this.stationary=options.stationary===true;this.effect={...(options.effect??noEffect)};
    const points=options.waypoints?.length?options.waypoints:[b];
    this.stops=[originals.map(i=>({...i.position})),...points.map(point=>originals.map(i=>({x:i.position.x+point.x-originals[0].position.x,y:i.position.y+point.y-originals[0].position.y})))];
    this.pauses=options.waypointPauses??[];this.pauseEffects=options.waypointEffects??[];
    this.hasWiggle=this.effect.effect==="wiggle"||this.pauseEffects.includes("wiggle");
    if(!options.resume||!this.routeStarted)this.savedPause=0;
    this.waitUntil=undefined;
    this.dpi = dpi; this.speed = speed; this.patrol = patrol; this.smooth = smooth;
    if (!options.resume || !this.routeStarted) {this.goingHome=false;this.targetIndex=1;}
    if (!patrol && this.goingHome) {
      // A one-way route continues from the paused cell toward the next outward stop.
      this.savedPause=0;this.goingHome=false;this.targetIndex=Math.min(this.stops.length-1,this.targetIndex+1);
    }
    this.targetIndex=Math.max(0,Math.min(this.stops.length-1,this.targetIndex));
    this.flip = options.flip&&!this.stationary; this.facing = options.facing;
    this.scales = this.latest.map((item,i) => ({x: Math.abs(item.scale.x) * (Math.sign(originals[i].scale.x) || 1), y: item.scale.y}));
    // Validate before opening an interaction.
    durationMs(this.latest[0].position, this.stops[this.targetIndex][0], dpi, speed);
    this.beginLeg(now);
    const interaction=await this.adapter.interact(this.latest);
    if(this.generation!==generation){interaction[1]();throw new Error("ยกเลิกการเริ่มเดินแล้ว");}
    this.interaction = interaction;
    this.started=this.clock?.()??now;
    this.effectStarted=this.started;this.renewed = this.started; this.running = true; this.routeStarted = true;
    this.lastTick=this.started;
    if(this.savedPause>0){this.waitUntil=this.started+this.savedPause;this.started-=this.duration;this.savedPause=0;this.setProgress(1);this.apply(1,this.lastTick);}
    else{this.setProgress(0);this.apply(0,this.started);}
  }
  private cleanPose():Item[]{return this.latest.map((item,i)=>({...item,position:{...this.basePositions[i]},...(this.hasWiggle?{rotation:this.rotations[i]}:{})}));}
  private apply(t: number,now:number) {
    if (!this.interaction) return;
    const paused=!this.stationary&&this.waitUntil!==undefined&&now<this.waitUntil;
    const override=paused?(this.pauseEffects[this.targetIndex]??"inherit"):"inherit";
    const effect=override==="inherit"?this.effect:{...this.effect,effect:override};
    const elapsed=override==="inherit"?now-this.effectStarted:now-(this.waitUntil!-(this.pauses[this.targetIndex]??0)*1000);
    const offset=effectOffset(effect,elapsed,this.dpi);
    this.latest = this.interaction[0](draft => draft.forEach((item, i) => {
      const base=this.stationary?this.basePositions[i]:positionAt(this.from[i], this.target[i], t, this.smooth);
      this.basePositions[i]={...base};item.position={x:base.x+offset.x,y:base.y+offset.y};
      if(this.hasWiggle)item.rotation=this.rotations[i]+offset.rotation;
      if (this.flip && item.type === "IMAGE") {
        const dx = this.target[i].x - this.from[i].x;
        // Horizontal routes face the direction of travel. Vertical routes flip on return.
        const sign = Math.abs(dx) > .01 ? (dx > 0 ? 1 : -1) * (this.facing === "right" ? 1 : -1) : Math.sign(this.scales[i].x) * (this.goingHome ? -1 : 1);
        item.scale = {x: Math.abs(this.scales[i].x) * sign, y: this.scales[i].y};
      }
    }));
  }
  private beginLeg(now: number) {
    this.from = this.basePositions.map(p => ({...p}));
    this.target = this.stops[this.targetIndex];
    this.duration = Math.max(...this.from.map((p, i) => durationMs(p, this.target[i], this.dpi, this.speed)));
    this.started = now;
  }
  private setProgress(t:number) {
    const legs=this.stops.length-1;
    this.progress=((this.goingHome?legs-1-this.targetIndex:this.targetIndex-1)+t)/legs;
  }
  async tick(now: number) {
    if(this.maintenanceError){const error=this.maintenanceError;this.maintenanceError=undefined;throw error;}
    if (!this.running || !this.interaction) return;
    this.lastTick=now;
    if(this.replacement) {
      const next=this.replacement;this.replacement=undefined;
      this.interaction[1]();this.interaction=next;this.renewed=now;
    }
    // Start early; the live interaction continues while the asynchronous replacement prepares.
    if(now-this.renewed>=20_000&&!this.renewal&&!this.replacement)this.renew();
    if(this.stationary){this.progress=0;this.apply(0,now);return;}
    // Consume overshoot so short cells and corners do not reduce the chosen speed.
    for(let crossed=0;crossed<1000;crossed++) {
      const t=Math.min(1,Math.max(0,(now-this.started)/this.duration));
      this.setProgress(t);this.apply(t,now);
      if(t<1)return;
      const arrival=this.started+this.duration;
      if(this.waitUntil===undefined)this.waitUntil=arrival+(this.pauses[this.targetIndex]??0)*1000;
      if(now<this.waitUntil){this.apply(1,now);return;}
      const arrived=this.waitUntil;this.waitUntil=undefined;
      if(!this.goingHome&&this.targetIndex===this.stops.length-1) {
        if(!this.patrol){await this.stop();return;}
        this.goingHome=true;
      } else if(this.goingHome&&this.targetIndex===0) this.goingHome=false;
      this.targetIndex+=this.goingHome?-1:1;
      this.beginLeg(arrived);this.setProgress(0);this.apply(0,now);
      // Skip complete cycles after a long browser suspension without shortcutting corners.
      if(this.patrol&&(this.targetIndex===1&&!this.goingHome)) {
        const cycle=2*this.stops.slice(1).reduce((sum,stop,i)=>sum+Math.max(...stop.map((p,j)=>durationMs(this.stops[i][j],p,this.dpi,this.speed))),0)+(this.pauses[0]??0)*1000+(this.pauses[this.stops.length-1]??0)*1000+2*this.pauses.slice(1,this.stops.length-1).reduce((a,b)=>a+b*1000,0);
        if(now-this.started>=cycle)this.started+=Math.floor((now-this.started)/cycle)*cycle;
      }
    }
    // A very long route after suspension resumes at the current cell on the next frame.
    this.started=now;
  }
  async stop(commit = true) {
    const wasRunning = this.running;
    if(commit&&!wasRunning&&!this.interaction&&!this.replacement){await this.commits;return;}
    if(wasRunning)this.savedPause=this.waitUntil===undefined?0:Math.max(0,this.waitUntil-this.lastTick);
    this.waitUntil=undefined;
    this.running = false;
    const generation=++this.generation;
    this.maintenanceError=undefined;
    // Remove the temporary effect in the live interaction before ending it and committing.
    // LINE's clean position remains the current point on its route.
    if(commit&&wasRunning&&this.interaction){
      const clean=this.cleanPose();
      this.latest=this.interaction[0](draft=>draft.forEach((item,i)=>{item.position={...clean[i].position};if(this.hasWiggle)item.rotation=this.rotations[i];}));
    }
    this.interaction?.[1](); this.interaction = undefined;
    this.replacement?.[1]();this.replacement=undefined;
    this.renewal=undefined;
    if (commit && wasRunning) await this.persist(this.cleanPose(),generation);
  }
}
