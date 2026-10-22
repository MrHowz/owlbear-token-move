import type {Item} from "@owlbear-rodeo/sdk";
import type {Motion,MotionAdapter} from "./motion";
import {effectOffset,noEffect,type EffectOptions} from "./effects";
import type {Anchor,Point} from "./shared";

type Pose={position:Point;rotation:number};
const near=(a:number,b:number)=>Math.abs(a-b)<.0001;
/** Only effect-owned fields are edited; other tools retain control of the clean pose.
 * No item interaction is held in this mode, so native drag/rotate tools can take over.
 * At most one atomic edit is in flight. Late frames are dropped, never queued.
 */
export class FreeEffect {
 running=false;progress=0;readonly direction="outbound" as const;readonly waypointIndex=1;readonly pauseRemaining=0;readonly completed=false;
 private generation=0;private ids:string[]=[];private effect:EffectOptions={...noEffect};private dpi=100;private started=0;private lastFrame=-Infinity;
 private poses=new Map<string,{base:Pose;applied:Pose}>();private inFlight?:Promise<void>;
 get revision(){return this.generation;}
 constructor(private adapter:MotionAdapter,private clock?:()=>number){}
 private async edit(recipe:(items:Item[])=>void){
  if(this.adapter.edit)await this.adapter.edit(this.ids,recipe);
  else{const items=await this.adapter.read(this.ids);recipe(items);await this.adapter.commit(items);}
 }
 async start(originals:Anchor[],_b:Point,dpi:number,_speed:number,_patrol:boolean,_smooth:boolean,now:number,options:Parameters<Motion["start"]>[7]){
  await this.stop();const generation=++this.generation;
  const fresh=await this.adapter.read(originals.map(i=>i.id));if(generation!==this.generation)throw new Error("ยกเลิกการเริ่มเอฟเฟกต์แล้ว");
  if(!fresh.length||fresh.length!==originals.length||fresh.some(i=>i.locked||i.attachedTo))throw new Error("Token หลักถูกลบ ล็อก หรือเปลี่ยนการ attach กรุณาเลือกใหม่");
  this.ids=originals.map(i=>i.id);this.dpi=dpi;this.effect={...(options?.effect??noEffect)};this.poses.clear();
  for(const item of fresh){const pose={position:{...item.position},rotation:item.rotation??0};this.poses.set(item.id,{base:structuredClone(pose),applied:structuredClone(pose)});}
  this.started=this.clock?.()??now;this.lastFrame=-Infinity;this.running=true;
 }
 private rebase(item:Item){
  const pose=this.poses.get(item.id)!;
  // A user/tool edit is a new anchor, not a displacement to undo on Stop.
  if(!near(item.position.x,pose.applied.position.x)||!near(item.position.y,pose.applied.position.y))pose.base.position={...item.position};
  if(!near(item.rotation??0,pose.applied.rotation))pose.base.rotation=item.rotation??0;
  return pose;
 }
 async tick(now:number){
  if(!this.running||this.inFlight||now-this.lastFrame<1000/30)return;
  this.lastFrame=now;const generation=this.generation,offset=effectOffset(this.effect,now-this.started,this.dpi);
  const task=this.edit(items=>{
   if(!this.running||generation!==this.generation)return;
   if(items.length!==this.ids.length||items.some(i=>i.locked||i.attachedTo))throw new Error("Token หลักถูกลบ ล็อก หรือเปลี่ยนการ attach กรุณาเลือกใหม่");
   for(const item of items){const pose=this.rebase(item);
    if(this.effect.effect==="shake")item.position={x:pose.base.position.x+offset.x,y:pose.base.position.y+offset.y};
    if(this.effect.effect==="wiggle")item.rotation=pose.base.rotation+offset.rotation;
    pose.applied={position:{...item.position},rotation:item.rotation??0};
   }
  });
  this.inFlight=task;try{await task;}finally{if(this.inFlight===task)this.inFlight=undefined;}
 }
 async stop(commit=true){
  const wasRunning=this.running;this.running=false;const generation=++this.generation;
  await this.inFlight?.catch(()=>{});
  if(!commit||!wasRunning)return;
  await this.edit(items=>{
   if(generation!==this.generation)return;
   for(const item of items){if(item.locked||item.attachedTo||!this.poses.has(item.id))continue;const pose=this.rebase(item);
    if(this.effect.effect==="shake")item.position={...pose.base.position};
    if(this.effect.effect==="wiggle")item.rotation=pose.base.rotation;
   }
  });
 }
 async waitForMaintenance(){await this.inFlight;}
}
