import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {FreeEffect} from "../src/free-effect";
import type {MotionAdapter} from "../src/motion";
import {noEffect} from "../src/effects";
function fixture(){
 const scene=new Map<string,Item>([["a",{id:"a",type:"IMAGE",name:"a",position:{x:100,y:200},rotation:25,scale:{x:1,y:1},locked:false} as Item]]);let interactions=0,edits=0;
 const adapter:MotionAdapter={read:async ids=>ids.flatMap(id=>scene.has(id)?[structuredClone(scene.get(id)!)]:[]),commit:async items=>{for(const i of items)scene.set(i.id,structuredClone(i));},interact:async()=>{interactions++;throw new Error("free effects must not hold item interactions");},edit:async(ids,recipe)=>{edits++;const draft=ids.flatMap(id=>scene.has(id)?[structuredClone(scene.get(id)!)]:[]);recipe(draft);for(const i of draft)scene.set(i.id,structuredClone(i));}};
 const motor=new FreeEffect(adapter);return {scene,adapter,motor,item:()=>scene.get("a")!,counts:()=>({interactions,edits}),start:async(effect:"wiggle"|"shake")=>motor.start([{...scene.get("a")!,name:"a"}],{x:0,y:0},100,1,true,false,0,{flip:false,facing:"right",resume:false,stationary:true,effect:{...noEffect,effect}})};
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
