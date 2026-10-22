import type OBR from "@owlbear-rodeo/sdk";
import {COMMAND,STATE,initialState,normalizedSettings,validSettings,type Command,type GroupView,type Settings,type State,type StatePacket} from "./shared";

type Draft={name:string;settings:Settings};
export interface PanelSnapshot{state:State;online:boolean;busy:boolean;error:string;drafts:Map<string,Draft>}
/** One command at a time, with ordered acknowledgements and retained unsaved edits. */
export class PanelController {
 private listeners=new Set<()=>void>();private snapshot:PanelSnapshot={state:{...initialState},online:false,busy:false,error:"",drafts:new Map()};
 private jobs:Array<()=>Promise<void>>=[];private working=false;private pending?:{request:string;command:Command;timer:ReturnType<typeof setTimeout>;resolve:(ok:boolean)=>void};
 private disposed=false;private cleanups:Array<()=>void>=[];
 constructor(private api:typeof OBR){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 getSnapshot=()=>this.snapshot;
 private emit(patch:Partial<PanelSnapshot>={}){this.snapshot={...this.snapshot,...patch};for(const fn of this.listeners)fn();}
 private finish(ok:boolean){if(!this.pending)return;clearTimeout(this.pending.timer);const resolve=this.pending.resolve;this.pending=undefined;resolve(ok);}
 private async send(command:Command):Promise<boolean>{
  if(!this.snapshot.online||this.disposed)return false;
  const request=crypto.randomUUID();const done=new Promise<boolean>(resolve=>{
   const timer=setTimeout(()=>{if(this.pending?.request===request){this.emit({error:"ไม่ได้รับคำตอบ กรุณาลองใหม่หรือรีโหลดห้อง"});this.finish(false);}},10000);
   this.pending={request,command,timer,resolve};
  });
  this.emit({error:""});
  void this.api.broadcast.sendMessage(COMMAND,{request,command},{destination:"LOCAL"}).catch(()=>{if(this.pending?.request===request){this.emit({error:"ส่งคำสั่งไม่สำเร็จ กรุณาลองใหม่"});this.finish(false);}});
  return done;
 }
 private queue(job:()=>Promise<void>,urgent=false){if(urgent)this.jobs.unshift(job);else this.jobs.push(job);void this.pump();}
 private async pump(){
  if(this.working)return;this.working=true;this.emit({busy:true});
  try{while(this.jobs.length&&!this.disposed){try{await this.jobs.shift()!();}catch(error){this.emit({error:error instanceof Error?error.message:"ทำรายการไม่สำเร็จ"});}}}
  finally{this.working=false;this.emit({busy:false});}
 }
 draft(g:GroupView):Draft{return this.snapshot.drafts.get(g.id)??{name:g.name,settings:normalizedSettings(g.settings)};}
 update(id:string,settings:Partial<Settings>={},name?:string){
  const g=this.snapshot.state.groups.find(g=>g.id===id);if(!g||g.running)return;
  const old=this.draft(g),next={name:name??old.name,settings:{...old.settings,...settings}};
  if(!validSettings(next.settings)){this.emit({error:"ตรวจค่าตัวเลขให้อยู่ในช่วงที่กำหนด"});return;}
  const drafts=new Map(this.snapshot.drafts);drafts.set(id,next);this.emit({drafts});this.queue(async()=>{await this.save(id);});
 }
 private async save(id:string){
  const draft=this.snapshot.drafts.get(id);if(!draft)return true;
  const ok=await this.send({type:"update",id,name:draft.name.trim()||"กลุ่มไม่มีชื่อ",settings:draft.settings});
  if(ok&&this.snapshot.drafts.get(id)===draft){const drafts=new Map(this.snapshot.drafts);drafts.delete(id);this.emit({drafts});}return ok;
 }
 perform(command:Command){
  const urgent=command.type==="stop"||command.type==="stopAll";
  if(command.type==="stopAll")this.jobs=[];
  this.queue(async()=>{
   if(!urgent&&"id"in command&&command.type!=="remove"&&!await this.save(command.id))return;
   if(command.type==="startAll")for(const id of this.snapshot.drafts.keys())if(!await this.save(id))return;
   await this.send(command);
  },urgent);
 }
 connect(){
  if(!this.api.isAvailable)return;
  this.api.onReady(async()=>{
   if(this.disposed)return;const connectionId=await this.api.player.getConnectionId();if(this.disposed)return;
   const transfers=new Map<string,{parts:Map<number,string>;total:number;created:number}>();
   this.cleanups.push(this.api.broadcast.onMessage(STATE,event=>{
    if(this.disposed||event.connectionId!==connectionId)return;const p=event.data as StatePacket;
    if(!p||typeof p.transfer!=="string"||typeof p.data!=="string"||!Number.isInteger(p.total)||p.total<1||p.total>10000||!Number.isInteger(p.index)||p.index<0||p.index>=p.total)return;
    for(const [id,t]of transfers)if(Date.now()-t.created>15000)transfers.delete(id);
    let t=transfers.get(p.transfer);if(!t){t={parts:new Map(),total:p.total,created:Date.now()};transfers.set(p.transfer,t);}if(t.total!==p.total)return;t.parts.set(p.index,p.data);
    if(t.parts.size!==t.total)return;transfers.delete(p.transfer);
    try{const state=JSON.parse(Array.from({length:p.total},(_,i)=>t!.parts.get(i)).join("")) as State;
     const ids=new Set(state.groups.map(g=>g.id));const drafts=new Map([...this.snapshot.drafts].filter(([id])=>ids.has(id)));
     this.emit({state,drafts});if(this.pending&&(this.pending.request===state.lastRequest||this.pending.command.type==="status"))this.finish(!state.error);
    }catch(error){console.error(error);}
   }));
   this.emit({online:true});this.perform({type:"status"});
  });
 }
 dispose(){this.disposed=true;this.finish(false);this.jobs=[];this.cleanups.forEach(fn=>fn());this.listeners.clear();}
}
