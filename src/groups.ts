import type {Item} from "@owlbear-rodeo/sdk";
import {Motion, type MotionAdapter} from "./motion";
import {defaultSettings, finitePoint, validSettings, validateConfig, type Anchor, type GroupConfig, type GroupView, type Point, type Settings} from "./shared";

interface Runtime {config:GroupConfig;motor:Motion;message:string;needsStart:boolean;settling?:Promise<void>}
export class Groups {
  private entries=new Map<string,Runtime>();
  constructor(private adapter:MotionAdapter,private clock?:()=>number){}
  private makeMotor(){return new Motion(this.adapter,this.clock);}
  private get(id:string){const e=this.entries.get(id);if(!e)throw new Error("ไม่พบกลุ่มนี้ กรุณาเลือกกลุ่มใหม่");return e;}
  has(id:string){return this.entries.has(id);}
  get running(){return [...this.entries.values()].some(e=>e.motor.running);}
  get size(){return this.entries.size;}
  create(id:string,items:Item[]=[]){
    if(!id||this.has(id))throw new Error("รหัสกลุ่มซ้ำ");
    const config:GroupConfig={id,name:`กลุ่ม ${this.size+1}`,anchors:[],settings:{...defaultSettings}};
    this.entries.set(id,{config,motor:this.makeMotor(),message:"เลือก Token แล้วสร้าง LINE",needsStart:true});
    try{if(items.length)this.capture(id,items);}catch(error){this.entries.delete(id);throw error;}
  }
  private requireStopped(e:Runtime){if(e.motor.running)throw new Error("หยุดกลุ่มนี้ก่อนแก้เส้นทางหรือการตั้งค่า");}
  private assertAvailable(e:Runtime,ids=new Set(e.config.anchors.map(a=>a.id))){
    const other=[...this.entries.values()].find(o=>o!==e&&o.motor.running&&o.config.anchors.some(a=>ids.has(a.id)));
    if(other)throw new Error(`Token ซ้ำกับกลุ่มที่กำลังเดิน: ${other.config.name} • หยุดกลุ่มอื่นก่อน`);
  }
  private anchors(items:Item[]):Anchor[]{
    if(!items.length)throw new Error("เลือก Token บนแผนที่ก่อน");
    const ids=new Set(items.map(i=>i.id));const roots=items.filter(i=>!i.attachedTo||!ids.has(i.attachedTo));
    if(!roots.length||roots.some(i=>i.locked||i.attachedTo))throw new Error("เลือกวัตถุหลักที่ปลดล็อกแล้ว (ไม่ใช่วัตถุแนบ)");
    return roots.map(i=>({id:i.id,name:(i.name||i.type).slice(0,120),type:i.type,position:{...i.position},scale:{...i.scale}}));
  }
  capture(id:string,items:Item[]){
    const e=this.get(id);this.requireStopped(e);const anchors=this.anchors(items);
    this.assertAvailable(e,new Set(anchors.map(a=>a.id)));
    e.config.anchors=anchors;e.motor=this.makeMotor();e.needsStart=true;
    e.message=e.config.route?"เปลี่ยน Token แล้ว • เส้นทางเดิมยังอยู่":"เพิ่ม Token แล้ว • คลิกสร้าง LINE เพื่อเลือกช่องเริ่ม";
  }
  update(id:string,name:string,settings:Settings){
    const e=this.get(id);this.requireStopped(e);
    if(!validSettings(settings))throw new Error("ความเร็วต้องอยู่ระหว่าง 0.1–20 ช่อง/วินาที");
    e.config.name=name.trim().slice(0,80)||"กลุ่มไม่มีชื่อ";e.config.settings={...settings};e.message="บันทึกการตั้งค่าแล้ว";
  }
  setPath(id:string,points:Point[]){
    const e=this.get(id);this.requireStopped(e);
    if(!Array.isArray(points)||points.length<2||points.length>501||!points.every(finitePoint))throw new Error("เลือกช่องเริ่มและช่องถัดไปอย่างน้อย 2 ช่อง");
    const route:Point[]=[];
    for(const p of points){const last=route.at(-1);if(!last||Math.hypot(p.x-last.x,p.y-last.y)>.01)route.push({...p});}
    if(route.length<2)throw new Error("เลือกช่องถัดไปให้ต่างจากช่องเริ่ม");
    e.config.route=route;e.motor=this.makeMotor();e.needsStart=true;e.message=`LINE ${route.length} จุดพร้อมแล้ว`;
  }
  setStart(id:string,point:Point){
    const e=this.get(id);this.requireStopped(e);
    if(!finitePoint(point)||!e.config.route)throw new Error("สร้าง LINE ก่อนเปลี่ยนช่องเริ่ม");
    this.setPath(id,[point,...e.config.route.slice(1)]);e.message="เปลี่ยนช่องเริ่มแล้ว • จุดอื่นยังอยู่ที่เดิม";
  }
  clearRoute(id:string){const e=this.get(id);this.requireStopped(e);e.config.route=undefined;e.motor=this.makeMotor();e.needsStart=true;}
  private lineAnchors(e:Runtime):Anchor[]{
    if(!e.config.route||!e.config.anchors.length)throw new Error("เลือก Token และสร้าง LINE ก่อนเริ่มเดิน");
    const origin=e.config.route[0],reference=e.config.anchors[0].position;
    return e.config.anchors.map(a=>({...a,position:{x:origin.x+a.position.x-reference.x,y:origin.y+a.position.y-reference.y}}));
  }
  private async place(e:Runtime){
    this.assertAvailable(e);const anchors=this.lineAnchors(e);
    const items=await this.adapter.read(anchors.map(a=>a.id));
    if(items.length!==anchors.length||items.some(i=>i.locked||i.attachedTo))throw new Error("วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น");
    const byId=new Map(anchors.map(a=>[a.id,a]));
    await this.adapter.commit(items.map(i=>({...i,position:{...byId.get(i.id)!.position},scale:{...byId.get(i.id)!.scale}})));
  }
  async start(id:string,dpi:number,now:number){
    const e=this.get(id);if(e.motor.running)return;
    const previous=e.motor,revision=previous.revision;
    await e.settling;
    if(e.motor!==previous||previous.revision!==revision)throw new Error("ยกเลิกการเริ่มเดินแล้ว");
    this.assertAvailable(e);const anchors=this.lineAnchors(e),route=e.config.route!,s=e.config.settings;
    if(e.needsStart||(s.mode==="once"&&e.motor.progress>=1)){
      await this.place(e);
      if(e.motor!==previous||previous.revision!==revision)throw new Error("ยกเลิกการเริ่มเดินแล้ว");
      e.motor=this.makeMotor();
    }
    await e.motor.start(anchors,route[route.length-1],dpi,s.speed,s.mode==="patrol",s.smooth,now,{flip:s.flip,facing:s.facing,resume:true,waypoints:route.slice(1)});
    e.needsStart=false;e.message=s.mode==="patrol"?"กำลังเดินวนตาม LINE":"กำลังเดินตาม LINE";
  }
  async stop(id:string,commit=true){const e=this.get(id);await e.motor.stop(commit);e.message="หยุดแล้ว • กดเดินต่อได้";}
  async stopAll(commit=true){await Promise.all([...this.entries.keys()].map(id=>this.stop(id,commit)));}
  async startAll(dpi:number,now:number){
    const errors:string[]=[];
    for(const [id,e]of this.entries){if(!e.config.route||!e.config.anchors.length||e.motor.running)continue;
      try{await this.start(id,dpi,now);}catch(error){e.message=error instanceof Error?error.message:"เริ่มไม่สำเร็จ";errors.push(`${e.config.name}: ${e.message}`);}}
    return errors;
  }
  async reset(id:string){
    const e=this.get(id);this.assertAvailable(e);this.lineAnchors(e);await e.settling;await e.motor.stop();await this.place(e);
    e.motor=this.makeMotor();e.needsStart=false;e.message="วางที่ช่องเริ่มของ LINE แล้ว";
  }
  async remove(id:string){await this.get(id).motor.stop();this.entries.delete(id);}
  async clear(){await this.stopAll(false);this.entries.clear();}
  async tick(now:number){
    const updates:Promise<void>[]=[];
    for(const e of this.entries.values()){
      if(!e.motor.running)continue;
      const motor=e.motor,update=motor.tick(now),revision=motor.revision;
      if(!motor.running)e.settling=update.catch(()=>{});
      updates.push(update.then(()=>{if(e.motor===motor&&motor.revision===revision&&!motor.running)e.message="เดินครบ LINE แล้ว • กดเริ่มเพื่อเดินรอบใหม่";})
        .catch(async error=>{if(e.motor!==motor||motor.revision!==revision)return;await motor.stop(false);e.message=error instanceof Error?error.message:"หยุดเพราะเกิดข้อผิดพลาด";}));
    }
    await Promise.all(updates);
  }
  async checkItems(items:Item[]){
    const byId=new Map(items.map(i=>[i.id,i]));
    for(const e of this.entries.values())if(e.motor.running&&e.config.anchors.some(a=>!byId.has(a.id)||byId.get(a.id)!.locked||byId.get(a.id)!.attachedTo)){
      await e.motor.stop(false);e.message="หยุดแล้ว: วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น";
    }
  }
  export():GroupConfig[]{return structuredClone([...this.entries.values()].map(e=>e.config));}
  hydrate(configs:unknown,version:2|3=3){
    if(!Array.isArray(configs))return;
    for(const value of configs){
      let candidate:unknown=value;
      if(version===2){
        const old=value as GroupConfig&{b?:Point};
        if(!old||!Array.isArray(old.anchors))continue;
        if(old.b&&!finitePoint(old.b))continue;
        if(old.route&&(!Array.isArray(old.route)||!old.route.length||old.route.length>500||!old.route.every(finitePoint)||!old.b||Math.hypot(old.route.at(-1)!.x-old.b.x,old.route.at(-1)!.y-old.b.y)>.01))continue;
        const points=old.anchors[0]&&old.b?[old.anchors[0].position,...(old.route??[old.b])]:undefined;
        if(points&&!points.every(finitePoint))continue;
        const route=points?.filter((p,i)=>i===0||Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y)>.01);
        candidate={id:old.id,name:old.name,anchors:old.anchors,settings:old.settings,route:route&&route.length>=2?route:undefined};
      }
      if(validateConfig(candidate)&&!this.has(candidate.id))this.entries.set(candidate.id,{config:structuredClone(candidate),motor:this.makeMotor(),message:candidate.route?"LINE พร้อมแล้ว • กดเริ่มเมื่อพร้อม":"สร้าง LINE เพื่อเลือกช่องเริ่ม",needsStart:true});
    }
  }
  views():GroupView[]{return [...this.entries.values()].map(({config:c,motor:m,message})=>({id:c.id,name:c.name,count:c.anchors.length,names:c.anchors.slice(0,3).map(a=>a.name),route:c.route?structuredClone(c.route):undefined,waypointIndex:m.waypointIndex,settings:{...c.settings},running:m.running,progress:m.progress,direction:m.direction,message}));}
}
