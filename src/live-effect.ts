import type {Motion,MotionAdapter} from "./motion";
import type {Item} from "@owlbear-rodeo/sdk";
import {followAttachments} from "./attachments";
import {effectCycleMs,effectOffset,noEffect,type EffectOptions} from "./effects";
import type {Anchor,Point} from "./shared";

type Stream=Awaited<ReturnType<MotionAdapter["interact"]>>;
export function effectFrame(draft:Item[],scene:Map<string,Item>,ids:string[],recipe:(items:Item[])=>void){
 for(const item of draft){const base=scene.get(item.id);if(base){item.position={...base.position};item.rotation=base.rotation;item.scale={...base.scale};}}
 const before=draft.map(i=>({...i,position:{...i.position},scale:{...i.scale}}));
 recipe(ids.map(id=>draft.find(i=>i.id===id)!));
 followAttachments(draft,before,new Set(ids));
}
/** Visual offsets live in Owlbear's interpolated interaction, never in scene history.
 * The adapter rebases each frame from the committed scene so other tools own the pose.
 */
export class LiveEffect {
 running=false;progress=0;readonly direction="outbound" as const;readonly waypointIndex=1;readonly pauseRemaining=0;
 private generation=0;private stream?:Stream;private replacement?:Stream;private maintenance?:Promise<void>;private error?:unknown;
 private ids:string[]=[];private effect:EffectOptions={...noEffect};private dpi=100;private started=0;private renewed=0;private loop=true;private duration=1000;
 get revision(){return this.generation;}
 get completed(){return !this.running&&this.progress>=1;}
 constructor(private adapter:MotionAdapter,private clock?:()=>number){}
 private async open(generation:number){
  const fresh=await this.adapter.read(this.ids);
  if(this.generation!==generation)return;
  if(fresh.length!==this.ids.length||fresh.some(i=>i.locked||i.attachedTo))throw new Error("Token หลักถูกลบ ล็อก หรือเปลี่ยนการ attach กรุณาเลือกใหม่");
  const stream=await this.adapter.freeInteract!(fresh);
  if(this.generation!==generation){stream[1]();return;}
  return stream;
 }
 async start(originals:Anchor[],_b:Point,dpi:number,_speed:number,loop:boolean,_smooth:boolean,now:number,options:Parameters<Motion["start"]>[7]){
  await this.stop();const generation=++this.generation;
  this.ids=originals.map(i=>i.id);this.effect={...(options?.effect??noEffect)};this.dpi=dpi;this.loop=loop;this.duration=effectCycleMs(this.effect);this.progress=0;this.error=undefined;
  const stream=await this.open(generation);
  if(!stream||this.generation!==generation){stream?.[1]();throw new Error("ยกเลิกการเริ่มเอฟเฟกต์แล้ว");}
  this.stream=stream;this.started=this.clock?.()??now;this.renewed=this.started;this.running=true;
 }
 private renew(){
  const generation=this.generation;
  const task=this.open(generation).then(stream=>{if(stream){if(this.generation===generation)this.replacement=stream;else stream[1]();}}).catch(error=>{if(this.generation===generation)this.error=error;});
  this.maintenance=task;void task.finally(()=>{if(this.maintenance===task)this.maintenance=undefined;});
 }
 async tick(now:number){
  if(!this.running)return;
  if(this.error){const error=this.error;this.error=undefined;throw error;}
  if(!this.loop&&now-this.started>=this.duration){this.progress=1;await this.stop();return;}
  if(this.replacement){this.stream?.[1]();this.stream=this.replacement;this.replacement=undefined;this.renewed=now;}
  if(now-this.renewed>=20_000&&!this.maintenance&&!this.replacement)this.renew();
  this.progress=Math.max(0,now-this.started)%this.duration/this.duration;
  const offset=effectOffset(this.effect,now-this.started,this.dpi);
  this.stream?.[0](items=>{for(const item of items){
   if(this.effect.effect==="wiggle")item.rotation+=offset.rotation;
   if(this.effect.effect==="shake")item.position={x:item.position.x+offset.x,y:item.position.y+offset.y};
  }});
 }
 async stop(_commit=true){
  this.running=false;++this.generation;
  // Removing the transient interaction reveals the latest committed pose. No cleanup
  // RPC can race a drag, fail at the deadline, or keep the Play button waiting.
  this.stream?.[1]();this.stream=undefined;this.replacement?.[1]();this.replacement=undefined;
 }
 async waitForMaintenance(){await this.maintenance;}
}
