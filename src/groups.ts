import type {Item} from "@owlbear-rodeo/sdk";
import {Motion, type MotionAdapter} from "./motion";
import {defaultSettings, finitePoint, validSettings, validateConfig, type Anchor, type GroupConfig, type GroupView, type Point, type Settings} from "./shared";

interface Runtime {config: GroupConfig; motor: Motion; message: string}
export class Groups {
  private entries = new Map<string, Runtime>();
  constructor(private adapter: MotionAdapter) {}
  private get(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("ไม่พบกลุ่มนี้ กรุณาเลือกกลุ่มใหม่");
    return entry;
  }
  has(id: string) {return this.entries.has(id);}
  get running() {return [...this.entries.values()].some(e => e.motor.running);}
  get size() {return this.entries.size;}
  create(id: string, items: Item[] = []) {
    if (!id || this.has(id)) throw new Error("รหัสกลุ่มซ้ำ");
    const config: GroupConfig = {id, name: `กลุ่ม ${this.size + 1}`, anchors: [], settings: {...defaultSettings}};
    this.entries.set(id, {config, motor: new Motion(this.adapter), message: "เลือก Token แล้วบันทึก A"});
    try {if (items.length) this.capture(id, items);} catch (error) {this.entries.delete(id); throw error;}
  }
  private requireStopped(e: Runtime) {if (e.motor.running) throw new Error("หยุดกลุ่มนี้ก่อนแก้เส้นทางหรือการตั้งค่า");}
  private anchors(items: Item[]): Anchor[] {
    if (!items.length) throw new Error("เลือก Token บนแผนที่ก่อน");
    const ids = new Set(items.map(i => i.id));
    const roots = items.filter(i => !i.attachedTo || !ids.has(i.attachedTo));
    if (!roots.length || roots.some(i => i.locked || i.attachedTo)) throw new Error("เลือกวัตถุหลักที่ปลดล็อกแล้ว (ไม่ใช่วัตถุแนบ)");
    return roots.map(i => ({id: i.id, name: (i.name || i.type).slice(0, 120), type: i.type, position: {...i.position}, scale: {...i.scale}}));
  }
  capture(id: string, items: Item[]) {
    const e = this.get(id); this.requireStopped(e);
    const anchors = this.anchors(items);
    const busy = [...this.entries.values()].find(other => other.motor.running && other.config.anchors.some(a => anchors.some(b => a.id === b.id)));
    if (busy) throw new Error(`Token นี้กำลังเดินใน ${busy.config.name} กรุณาหยุดกลุ่มนั้นก่อน`);
    e.config.anchors = anchors; e.config.b = undefined; e.config.route = undefined; e.motor = new Motion(this.adapter); e.message = "บันทึก A แล้ว • เลือกช่อง B หรือสร้าง LINE";
  }
  update(id: string, name: string, settings: Settings) {
    const e = this.get(id); this.requireStopped(e);
    if (!validSettings(settings)) throw new Error("การตั้งค่าไม่ถูกต้อง • ความเร็วต้องอยู่ระหว่าง 0.1–20");
    e.config.name = name.trim().slice(0,80) || "กลุ่มไม่มีชื่อ";
    e.config.settings = {...settings}; e.message = "บันทึกการตั้งค่าแล้ว";
  }
  setB(id: string, point: Point) {
    const e = this.get(id); this.requireStopped(e);
    if (!e.config.anchors.length) throw new Error("กรุณาบันทึก A ก่อน");
    if (!finitePoint(point)) throw new Error("พิกัด B ไม่ถูกต้อง");
    const a = e.config.anchors[0].position;
    if (Math.hypot(point.x-a.x, point.y-a.y) < .01) throw new Error("เลือกจุด B ให้ต่างจาก A");
    e.config.b = {...point}; e.config.route = undefined; e.motor = new Motion(this.adapter); e.message = "พร้อมเดิน • ตั้งค่าแล้วกดเริ่มกลุ่มนี้";
  }
  setPath(id: string, points: Point[]) {
    const e=this.get(id); this.requireStopped(e);
    if(!e.config.anchors.length) throw new Error("บันทึก A ก่อนสร้าง LINE");
    if(!Array.isArray(points)||!points.length||points.length>500||!points.every(finitePoint)) throw new Error("LINE ต้องมี 1–500 ช่อง");
    let previous=e.config.anchors[0].position;
    const route: Point[]=[];
    for(const point of points) if(Math.hypot(point.x-previous.x,point.y-previous.y)>.01){route.push({...point});previous=point;}
    if(!route.length) throw new Error("เลือกช่องเดินที่ต่างจาก A อย่างน้อย 1 ช่อง");
    e.config.route=route; e.config.b={...route[route.length-1]}; e.motor=new Motion(this.adapter); e.message=`บันทึก LINE ${route.length} จุดแล้ว • พร้อมเดิน`;
  }
  clearDestination(id:string) {
    const e=this.get(id);this.requireStopped(e);
    e.config.b=undefined;e.config.route=undefined;e.motor=new Motion(this.adapter);e.message="A และ B อยู่ช่องเดียวกัน • เลือกช่อง B ใหม่";
  }
  async start(id: string, dpi: number, now: number) {
    const e = this.get(id);
    if (e.motor.running) return;
    if (!e.config.b || !e.config.anchors.length) throw new Error("กำหนด A และ B ให้กลุ่มนี้ก่อน");
    const ids = new Set(e.config.anchors.map(a => a.id));
    const conflict = [...this.entries.values()].find(o => o !== e && o.motor.running && o.config.anchors.some(a => ids.has(a.id)));
    if (conflict) throw new Error(`Token ซ้ำกับกลุ่มที่กำลังเดิน: ${conflict.config.name}`);
    const s = e.config.settings;
    await e.motor.start(e.config.anchors, e.config.b, dpi, s.speed, s.mode === "patrol", s.smooth, now, {flip:s.flip, facing:s.facing, resume:true,waypoints:e.config.route});
    e.message = s.mode === "patrol" ? "กำลังวนไปกลับ A ↔ B" : "กำลังเดินไป B";
  }
  async stop(id: string, commit = true) {const e=this.get(id); await e.motor.stop(commit); e.message="หยุดแล้ว • กดเริ่มเพื่อเดินต่อ";}
  async stopAll(commit = true) {for (const id of this.entries.keys()) await this.stop(id,commit);}
  async startAll(dpi: number, now: number) {
    const errors: string[] = [];
    for (const [id,e] of this.entries) {
      if (!e.config.b || !e.config.anchors.length || e.motor.running) continue;
      try {await this.start(id,dpi,now);} catch(error) {e.message=error instanceof Error?error.message:"เริ่มไม่สำเร็จ"; errors.push(`${e.config.name}: ${e.message}`);}
    }
    return errors;
  }
  async reset(id: string) {
    const e=this.get(id);
    // Another group may currently own a shared token, even while this group is stopped.
    const ids = new Set(e.config.anchors.map(a=>a.id));
    if ([...this.entries.values()].some(o=>o!==e&&o.motor.running&&o.config.anchors.some(a=>ids.has(a.id)))) throw new Error("หยุดกลุ่มอื่นที่ใช้ Token ชุดนี้ก่อนกลับ A");
    await e.motor.stop();
    const items=await this.adapter.read([...ids]);
    if (items.length!==ids.size || items.some(i=>i.locked||i.attachedTo)) throw new Error("วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น");
    await this.adapter.commit(items.map(i=>{
      const a=e.config.anchors.find(a=>a.id===i.id)!;
      return {...i, position:{...a.position}, scale:{...a.scale}};
    }));
    e.motor=new Motion(this.adapter); e.message="กลับ A และคืนการ Flip เดิมแล้ว";
  }
  async remove(id: string) {await this.get(id).motor.stop(); this.entries.delete(id);}
  async clear() {await this.stopAll(false); this.entries.clear();}
  async tick(now: number) {
    for (const e of this.entries.values()) {
      if (!e.motor.running) continue;
      try {await e.motor.tick(now); if (!e.motor.running) e.message="ถึง B แล้ว • กลับ A เพื่อเริ่มรอบใหม่";}
      catch(error) {await e.motor.stop(false); e.message=error instanceof Error?error.message:"หยุดเพราะเกิดข้อผิดพลาด";}
    }
  }
  async checkItems(items: Item[]) {
    const byId=new Map(items.map(i=>[i.id,i]));
    for (const e of this.entries.values()) {
      if (e.motor.running && e.config.anchors.some(a=>!byId.has(a.id)||byId.get(a.id)!.locked||byId.get(a.id)!.attachedTo)) {
        await e.motor.stop(false); e.message="หยุดแล้ว: วัตถุถูกลบ ล็อก หรือแนบกับวัตถุอื่น";
      }
    }
  }
  export(): GroupConfig[] {return structuredClone([...this.entries.values()].map(e=>e.config));}
  hydrate(configs: unknown) {
    if (!Array.isArray(configs)) return;
    for (const config of configs) if (validateConfig(config) && !this.has(config.id)) {
      this.entries.set(config.id,{config:structuredClone(config),motor:new Motion(this.adapter),message:"โหลดเส้นทางแล้ว • พร้อมเริ่มเมื่อคุณสั่ง"});
    }
  }
  views(): GroupView[] {
    return [...this.entries.values()].map(({config:c,motor:m,message})=>({id:c.id,name:c.name,count:c.anchors.length,names:c.anchors.slice(0,3).map(a=>a.name),a:c.anchors[0]?.position,b:c.b,route:c.route?structuredClone(c.route):undefined,waypointIndex:m.waypointIndex,settings:{...c.settings},running:m.running,progress:m.progress,direction:m.direction,message}));
  }
}
