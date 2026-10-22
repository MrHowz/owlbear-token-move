import {test} from "node:test";
import assert from "node:assert/strict";
import type OBR from "@owlbear-rodeo/sdk";
import {PanelController} from "../src/panel-controller";
import {defaultSettings,initialState,statePackets,type Command,type State} from "../src/shared";
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function fixture(){
 let listener:(event:any)=>void=()=>{};const sent:Array<{request:string;command:Command}>=[];
 const api={isAvailable:true,onReady:(fn:()=>void)=>{fn();},player:{getConnectionId:async()=>"me"},broadcast:{onMessage:(_name:string,fn:typeof listener)=>{listener=fn;return()=>{};},sendMessage:async(_name:string,data:any)=>{sent.push(data);}}} as unknown as typeof OBR;
 const controller=new PanelController(api);controller.connect();await flush();
 let state:State={...initialState,ready:true,gm:true,groups:[{id:"g",name:"Guard",count:1,names:["a"],settings:{...defaultSettings},running:false,progress:0,direction:"outbound",message:"ready"}]};
 function reply(index:number,error?:string){const msg=sent[index];if(msg.command.type==="update")state={...state,groups:state.groups.map(g=>g.id===msg.command.id?{...g,name:msg.command.name,settings:msg.command.settings}:g)};
  if(msg.command.type==="remove")state={...state,groups:[]};state={...state,lastRequest:msg.request,error};for(const data of statePackets(state))listener({connectionId:"me",data});
 }
 reply(0);await flush();return {controller,sent,reply};
}
test("rapid edits retain the latest settings until their own ordered acknowledgement",async()=>{
 const f=await fixture();f.controller.update("g",{speed:3});await flush();f.controller.update("g",{mode:"once"});f.reply(1);await flush();assert.equal(f.controller.getSnapshot().drafts.get("g")?.settings.mode,"once");assert.equal(f.sent[2].command.type,"update");const next=f.sent[2].command as Extract<Command,{type:"update"}>;assert.equal(next.settings.speed,3);assert.equal(next.settings.mode,"once");f.reply(2);await flush();assert.equal(f.controller.getSnapshot().drafts.size,0);f.controller.dispose();
});
test("a rejected save keeps its draft and prevents Play with unacknowledged settings",async()=>{
 const f=await fixture();f.controller.update("g",{speed:4});await flush();f.controller.perform({type:"start",id:"g"});f.reply(1,"save failed");await flush();assert.equal(f.sent[2].command.type,"update");f.reply(2,"save failed");await flush();assert.equal(f.sent.some(m=>m.command.type==="start"),false);assert.equal(f.controller.getSnapshot().drafts.get("g")?.settings.speed,4);f.controller.dispose();
});
test("removing a group clears pending drafts and does not leave stale unsaved UI",async()=>{
 const f=await fixture();f.controller.update("g",{speed:4});await flush();f.reply(1,"save failed");await flush();f.controller.perform({type:"remove",id:"g"});await flush();f.reply(2);await flush();assert.equal(f.controller.getSnapshot().state.groups.length,0);assert.equal(f.controller.getSnapshot().drafts.size,0);f.controller.dispose();
});
