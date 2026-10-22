import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import type {MotionAdapter} from "../src/motion";
import {LiveEffect,effectFrame} from "../src/live-effect";
import {noEffect} from "../src/effects";
import {Groups} from "../src/groups";
function fixture(){
 const scene=new Map<string,Item>([["a",{id:"a",type:"IMAGE",name:"a",position:{x:100,y:200},rotation:25,scale:{x:1,y:1},locked:false} as Item]]);
 const streams=new Map<number,Item[]>();let opens=0,frames=0,reads=0,writes=0;let gate:Promise<void>|undefined;
 const adapter:MotionAdapter={read:async ids=>{reads++;return ids.map(id=>structuredClone(scene.get(id)!));},interact:async()=>{throw Error("wrong stream");},commit:async()=>{writes++;},freeInteract:async roots=>{
  const id=++opens;await gate;streams.set(id,structuredClone([...scene.values()]));return [recipe=>{frames++;const draft=structuredClone(streams.get(id)!);effectFrame(draft,scene,roots.map(i=>i.id),recipe);streams.set(id,draft);return roots.map(r=>draft.find(i=>i.id===r.id)!);},()=>{streams.delete(id);}];
 }};
 const motor=new LiveEffect(adapter);return {scene,motor,streams,adapter,block:(p:Promise<void>)=>gate=p,counts:()=>({opens,frames,reads,writes}),view:()=>[...streams.values()].at(-1)?.find(i=>i.id==="a")??scene.get("a")!,start:async(effect:"wiggle"|"shake"="wiggle",loop=true)=>motor.start([{...scene.get("a")!,name:"a"}],{x:0,y:0},100,1,loop,false,0,{flip:false,facing:"right",resume:false,effect:{...noEffect,effect}})};
}
test("free animation streams every frame without scene reads, writes or pose drift",async()=>{
 const f=fixture();await f.start();for(let n=0;n<120;n++)await f.motor.tick(n*1000/60);
 assert.deepEqual(f.counts(),{opens:1,frames:120,reads:1,writes:0});assert.equal(f.scene.get("a")!.rotation,25);assert.ok(Math.abs(f.view().rotation-25)<=8);await f.motor.stop();assert.equal(f.view().rotation,25);assert.equal(f.streams.size,0);
});
test("free wiggle follows external move, rotation and scale without anchoring the token",async()=>{
 const f=fixture();await f.start();await f.motor.tick(1000/6);assert.ok(Math.abs(f.view().rotation-33)<1e-6);
 Object.assign(f.scene.get("a")!,{position:{x:900,y:800},rotation:90,scale:{x:2,y:3}});await f.motor.tick(500);
 assert.equal(f.view().rotation,82);assert.deepEqual(f.view().position,{x:900,y:800});assert.deepEqual(f.view().scale,{x:2,y:3});await f.motor.stop();assert.equal(f.view().rotation,90);
});
test("free shake uses the current dragged pose and Stop performs no cleanup RPC",async()=>{
 const f=fixture();await f.start("shake");await f.motor.tick(250);f.scene.get("a")!.position={x:1234,y:4321};await f.motor.tick(500);assert.ok(Math.abs(f.view().position.x-1234)<=4);await f.motor.stop();assert.deepEqual(f.view().position,{x:1234,y:4321});assert.equal(f.counts().writes,0);
});
test("Once finishes synchronously, clears the visual offset and can play again",async()=>{
 const f=fixture();await f.start("wiggle",false);await f.motor.tick(500);assert.equal(f.view().rotation,17);const done=f.motor.tick(2000/3);assert.equal(f.motor.running,false);await done;assert.equal(f.motor.completed,true);assert.equal(f.streams.size,0);await f.start("wiggle",false);await f.motor.tick(1000/6);assert.ok(f.view().rotation>25);await f.motor.stop();
});
test("renewal I/O cannot stall frames, exceed 30 seconds or restart a cancelled effect",async()=>{
 const f=fixture();await f.start();let release!:()=>void;f.block(new Promise<void>(r=>release=r));await f.motor.tick(20000);await Promise.resolve();const before=f.counts().frames;
 for(let n=1;n<=60;n++)await f.motor.tick(20000+n*1000/60);assert.equal(f.counts().frames,before+60);await f.motor.stop();release();await f.motor.waitForMaintenance();assert.equal(f.streams.size,0);assert.equal(f.motor.running,false);
});
test("successful renewal preserves phase and external attachment offsets",async()=>{
 const f=fixture();f.scene.set("child",{...structuredClone(f.scene.get("a")!),id:"child",attachedTo:"a",position:{x:200,y:200},rotation:0});await f.start();await f.motor.tick(20000);await f.motor.waitForMaintenance();await f.motor.tick(20100);assert.equal(f.streams.size,1);assert.equal(f.counts().opens,2);
 const root=f.view(),child=[...f.streams.values()][0].find(i=>i.id==="child")!;assert.ok(Math.abs(Math.hypot(child.position.x-root.position.x,child.position.y-root.position.y)-100)<1e-6);assert.ok(Math.abs(child.rotation-(root.rotation-25))<1e-6);await f.motor.stop();assert.equal(f.counts().writes,0);
});
test("cancelling a pending initial stream cannot revive the effect or leak an interaction",async()=>{
 const f=fixture();let release!:()=>void;f.block(new Promise<void>(r=>release=r));const start=f.start();const rejected=assert.rejects(start,/ยกเลิก/);await Promise.resolve();await Promise.resolve();await Promise.resolve();await f.motor.stop();release();await rejected;assert.equal(f.motor.running,false);assert.equal(f.streams.size,0);
});
test("a locked root is rejected before a live effect opens",async()=>{
 const f=fixture();f.scene.get("a")!.locked=true;await assert.rejects(f.start(),/ล็อก/);assert.equal(f.counts().opens,0);assert.equal(f.motor.running,false);
});
test("selected tokens never open an effect interaction; deselection starts at the latest dragged pose",async()=>{
 const f=fixture();f.motor.setManualPaused(true,0);await f.start();assert.equal(f.motor.running,true);assert.equal(f.motor.pausedForManual,true);assert.equal(f.counts().opens,0);
 await f.motor.tick(10000);assert.equal(f.motor.progress,0);f.scene.get("a")!.position={x:432,y:876};f.motor.setManualPaused(false,10000);await f.motor.waitForMaintenance();await f.motor.tick(10000+1000/6);assert.equal(f.motor.pausedForManual,false);assert.deepEqual(f.view().position,{x:432,y:876});assert.ok(Math.abs(f.view().rotation-33)<1e-6);await f.motor.stop();
});
test("native editing removes all effect streams and freezes Once until selection is released",async()=>{
 const f=fixture();await f.start("wiggle",false);await f.motor.tick(1000/6);f.motor.setManualPaused(true,200);assert.equal(f.streams.size,0);
 f.scene.get("a")!.rotation=90;f.scene.get("a")!.position={x:777,y:888};const frames=f.counts().frames;await f.motor.tick(5000);assert.equal(f.motor.running,true);assert.equal(f.counts().frames,frames);
 f.motor.setManualPaused(false,5200);await f.motor.waitForMaintenance();await f.motor.tick(5500);assert.equal(f.view().rotation,82);assert.deepEqual(f.view().position,{x:777,y:888});await f.motor.tick(5700);assert.equal(f.motor.running,false);assert.equal(f.view().rotation,90);
});
test("a new selection cancels a slow resume without leaking a competing interaction",async()=>{
 const f=fixture();await f.start();f.motor.setManualPaused(true,100);let release!:()=>void;f.block(new Promise<void>(r=>release=r));f.motor.setManualPaused(false,200);const resumed=f.motor.waitForMaintenance();await Promise.resolve();f.motor.setManualPaused(true,210);release();await resumed;await f.motor.tick(500);assert.equal(f.streams.size,0);assert.equal(f.motor.running,true);assert.equal(f.motor.pausedForManual,true);await f.motor.stop();
});
test("selecting a nested attachment pauses only its own free effect group",async()=>{
 const f=fixture();const child={...structuredClone(f.scene.get("a")!),id:"child",attachedTo:"a"};const nested={...structuredClone(child),id:"nested",attachedTo:"child"};f.scene.set(child.id,child);f.scene.set(nested.id,nested);
 const groups=new Groups(f.adapter);groups.create("group",[f.scene.get("a")!]);groups.update("group","group",{speed:2,mode:"patrol",smooth:false,flip:false,facing:"right",movement:"stationary",effect:"wiggle"});groups.manualSelection(["nested"],f.scene,0);await groups.start("group",100,0);assert.equal(groups.views()[0].manualPaused,true);assert.equal(f.counts().opens,0);
 groups.manualSelection(["unrelated"],f.scene,1000);await groups.tick(1001);await Promise.resolve();await Promise.resolve();assert.equal(groups.views()[0].manualPaused,false);await groups.stopAll();
});
