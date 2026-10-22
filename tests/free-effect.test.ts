import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {FreeEffect} from "../src/free-effect";
import type {MotionAdapter} from "../src/motion";
import {noEffect} from "../src/effects";
function fixture(){
 const scene=new Map<string,Item>([["a",{id:"a",type:"IMAGE",name:"a",position:{x:100,y:200},rotation:25,scale:{x:1,y:1},locked:false} as Item]]);let interactions=0,edits=0;
 const adapter:MotionAdapter={read:async ids=>ids.flatMap(id=>scene.has(id)?[structuredClone(scene.get(id)!)]:[]),commit:async items=>{for(const i of items)scene.set(i.id,structuredClone(i));},interact:async()=>{interactions++;throw new Error("free effects must not hold item interactions");},edit:async(ids,recipe)=>{edits++;const draft=ids.flatMap(id=>scene.has(id)?[structuredClone(scene.get(id)!)]:[]);recipe(draft);for(const i of draft)scene.set(i.id,structuredClone(i));}};
 const motor=new FreeEffect(adapter);return {scene,adapter,motor,item:()=>scene.get("a")!,counts:()=>({interactions,edits}),start:async(effect:"wiggle"|"shake",loop=true,effectSpeed=1)=>motor.start([{...scene.get("a")!,name:"a"}],{x:0,y:0},100,1,loop,false,0,{flip:false,facing:"right",resume:false,stationary:true,effect:{...noEffect,effect,effectSpeed}})};
}
test("free wiggle allows drag, rotation and scale edits and Stop keeps the latest user pose",async()=>{
 const f=fixture();await f.start("wiggle");await f.motor.tick(1000/6);assert.ok(Math.abs(f.item().rotation-33)<1e-7);
 f.item().position={x:900,y:800};f.item().rotation=90;f.item().scale={x:2,y:3};await f.motor.tick(500);assert.deepEqual(f.item().position,{x:900,y:800});assert.equal(f.item().rotation,82);await f.motor.stop();assert.equal(f.item().rotation,90);assert.deepEqual(f.item().position,{x:900,y:800});assert.deepEqual(f.item().scale,{x:2,y:3});assert.equal(f.counts().interactions,0);
});
test("free shake rebases to a dragged position without drift or snapping back",async()=>{
 const f=fixture();await f.start("shake");await f.motor.tick(250);assert.notEqual(f.item().position.x,100);
 f.item().position={x:500,y:600};await f.motor.tick(500);for(let t=550;t<5000;t+=50){await f.motor.tick(t);assert.ok(Math.abs(f.item().position.x-500)<=4.00001);assert.ok(Math.abs(f.item().position.y-600)<=2.60001);}
 await f.motor.stop();assert.deepEqual(f.item().position,{x:500,y:600});assert.equal(f.item().rotation,25);
});
test("stopping immediately after an external edit does not undo that edit",async()=>{
 const f=fixture();await f.start("shake");await f.motor.tick(250);f.item().position={x:1234,y:4321};await f.motor.stop();assert.deepEqual(f.item().position,{x:1234,y:4321});
});
test("slow effect writes drop frames and cancellation prevents late writes",async()=>{
 const f=fixture();await f.start("wiggle");let release!:()=>void;const gate=new Promise<void>(r=>release=r);const original=f.adapter.edit!;let calls=0;
 f.adapter.edit=async(ids,recipe)=>{calls++;await gate;await original(ids,recipe);};
 const frame=f.motor.tick(250);await f.motor.tick(500);assert.equal(calls,1);const stopped=f.motor.stop(false);release();await frame;await stopped;assert.equal(f.item().rotation,25);assert.equal(f.motor.running,false);
});
test("free effects stop safely if their root is locked or removed",async()=>{
 const f=fixture();await f.start("wiggle");f.item().locked=true;await assert.rejects(f.motor.tick(250),/ล็อก/);await f.motor.stop(false);assert.equal(f.item().rotation,25);
});


test("one-shot wiggle completes both directions and restores the latest user pose automatically",async()=>{
 const f=fixture();await f.start("wiggle",false);await f.motor.tick(1000/6);assert.ok(f.item().rotation>25);await f.motor.tick(500);assert.ok(f.item().rotation<25);
 f.item().position={x:700,y:800};f.item().rotation=90;await f.motor.tick(2000/3);
 assert.equal(f.motor.running,false);assert.equal(f.motor.completed,true);assert.equal(f.motor.progress,1);assert.equal(f.item().rotation,90);assert.deepEqual(f.item().position,{x:700,y:800});
});
test("one-shot shake stops after one common cycle and keeps a newly dragged position",async()=>{
 const f=fixture();await f.start("shake",false);await f.motor.tick(250);f.item().position={x:1234,y:4321};await f.motor.tick(500);await f.motor.tick(1000);
 assert.equal(f.motor.running,false);assert.deepEqual(f.item().position,{x:1234,y:4321});assert.equal(f.item().rotation,25);
});
test("effect tempo changes one-shot length while Loop continues across many cycles",async()=>{
 const f=fixture();await f.start("wiggle",false,2);await f.motor.tick(300);assert.equal(f.motor.running,true);await f.motor.tick(1000/3);assert.equal(f.motor.running,false);
 await f.start("shake",true,.25);await f.motor.tick(100000);assert.equal(f.motor.running,true);assert.equal(f.motor.completed,false);await f.motor.stop();
});
test("a completed effect can be played again from the current pose",async()=>{
 const f=fixture();await f.start("wiggle",false);await f.motor.tick(1000);f.item().rotation=120;await f.start("wiggle",false);assert.equal(f.motor.progress,0);await f.motor.tick(1000/6);assert.ok(Math.abs(f.item().rotation-128)<1e-6);await f.motor.tick(1000);assert.equal(f.item().rotation,120);
});
test("deadline during a slow write waits for cleanup and cannot leave a late tilted pose",async()=>{
 const f=fixture();await f.start("wiggle",false);let release!:()=>void;const gate=new Promise<void>(r=>release=r),original=f.adapter.edit!;
 let calls=0;f.adapter.edit=async(ids,recipe)=>{if(++calls===1)await gate;await original(ids,recipe);};
 const frame=f.motor.tick(250);const completed=f.motor.tick(1000);assert.equal(f.motor.running,false);release();await frame;await completed;assert.equal(f.item().rotation,25);assert.equal(f.motor.completed,true);
});

test("Loop retries a rejected scene update and continues through later cycles without pose drift",async()=>{
 const f=fixture();await f.start("wiggle");const original=f.adapter.edit!;let attempts=0;f.adapter.edit=async(ids,recipe)=>{if(++attempts<=2)throw new Error("temporary write error");await original(ids,recipe);};
 await f.motor.tick(100);await f.motor.tick(400);await f.motor.tick(1000);assert.equal(f.motor.running,true);assert.equal(attempts,3);await f.motor.tick(1500);assert.equal(f.item().rotation,33);await f.motor.stop();assert.equal(f.item().rotation,25);
});
test("an applied write with a lost reply is not mistaken for a new user rotation",async()=>{
 const f=fixture();await f.start("wiggle");const original=f.adapter.edit!;let attempts=0;f.adapter.edit=async(ids,recipe)=>{await original(ids,recipe);if(++attempts===1)throw new Error("lost acknowledgement");};
 await f.motor.tick(1000/6);assert.ok(Math.abs(f.item().rotation-33)<1e-6);await f.motor.tick(500);assert.equal(f.item().rotation,17);await f.motor.stop();assert.equal(f.item().rotation,25);
});
test("persistent scene failures end the engine instead of leaving a frozen active effect",async()=>{
 const f=fixture();await f.start("wiggle");f.adapter.edit=async()=>{throw new Error("offline");};await f.motor.tick(0);await f.motor.tick(300);await f.motor.tick(900);await assert.rejects(f.motor.tick(2000),/offline/);await f.motor.stop(false);assert.equal(f.motor.running,false);
});

