import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {Motion, type MotionAdapter} from "../src/motion";
import {durationMs, positionAt} from "../src/shared";

function fixture(scaleX=2,type="IMAGE") {
  let items = [{id:"one",name:"One",type,scale:{x:scaleX,y:3}, position:{x:0,y:0}, locked:false}, {id:"two",name:"Two",type:"IMAGE",scale:{x:1,y:1}, position:{x:50,y:100}, locked:false}] as Item[];
  let live=structuredClone(items);
  let interactions = 0, stops = 0, commits = 0;
  const adapter: MotionAdapter = {
    read: async ids => structuredClone(items.filter(i => ids.includes(i.id)).reverse()),
    interact: async base => {
      interactions++;
      let current = structuredClone(base);
      return [recipe => {current = structuredClone(current); recipe(current); live=structuredClone(current); return structuredClone(current);}, () => {stops++;}];
    },
    commit: async updated => {commits++; items = structuredClone(updated);}
  };
  return {motor:new Motion(adapter), initial:structuredClone(items), items:() => items, live:()=>live, counts:() => ({interactions,stops,commits}), remove:() => {items=[];}};
}
test("grid speed converts to duration and invalid inputs fail", () => {
  assert.equal(durationMs({x:0,y:0},{x:300,y:400},100,2),2500);
  for (const speed of [0,-1,NaN,Infinity,21]) assert.throws(() => durationMs({x:0,y:0},{x:1,y:1},100,speed));
  assert.throws(() => durationMs({x:0,y:0},{x:1,y:1},0,1));
});
test("easing preserves endpoints and clamps elapsed time", () => {
  assert.deepEqual(positionAt({x:0,y:0},{x:100,y:200},-1,true),{x:0,y:0});
  assert.deepEqual(positionAt({x:0,y:0},{x:100,y:200},2,true),{x:100,y:200});
  assert.equal(positionAt({x:0,y:0},{x:100,y:0},.25,true).x,15.625);
});
test("one-way movement lands exactly on B while preserving group offsets", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:300,y:0},100,1,false,false,0);
  await f.motor.tick(3000);
  assert.equal(f.motor.running,false);
  assert.deepEqual(f.items().map(i=>i.position),[{x:300,y:0},{x:350,y:100}]);
  assert.equal(f.counts().commits,1);
});
test("stop saves the intermediate position and subsequent ticks do nothing", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:300,y:0},100,1,false,false,0);
  await f.motor.tick(1500); await f.motor.stop(); await f.motor.tick(3000);
  assert.deepEqual(f.items()[0].position,{x:150,y:0});
});
test("patrol returns to A and continues toward B", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0);
  await f.motor.tick(1000); await f.motor.tick(2000); await f.motor.stop();
  assert.deepEqual(f.items().map(i=>i.position),f.initial.map(i=>i.position));
});
test("long movements renew interactions before the SDK timeout", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:10000,y:0},100,1,false,false,0);
  await f.motor.tick(10000); await f.motor.tick(20000); await f.motor.tick(40000); await f.motor.tick(100000);
  assert.equal(f.motor.running,false);
  assert.deepEqual(f.items()[0].position,{x:10000,y:0});
  assert.equal(f.counts().interactions,4);
});
test("deleted items cannot be restarted and stopping on scene change does not commit", async () => {
  const f=fixture(); await f.motor.start(f.initial,{x:100,y:0},100,1,false,false,0);
  await f.motor.tick(500); await f.motor.stop(false);
  assert.equal(f.counts().commits,0);
  f.remove(); await assert.rejects(f.motor.start(f.initial,{x:100,y:0},100,1,false,false,0));
});
test("patrol flips on arrival at each endpoint without changing size or Y scale",async()=>{
  const f=fixture(); await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0,{flip:true,facing:"right",resume:false});
  assert.deepEqual(f.live()[0].scale,{x:2,y:3});
  await f.motor.tick(1000); assert.equal(f.motor.direction,"return");assert.deepEqual(f.live()[0].scale,{x:-2,y:3});
  await f.motor.tick(2000);assert.equal(f.motor.direction,"outbound");assert.deepEqual(f.live()[0].scale,{x:2,y:3});
});
test("left-facing artwork and a route going left use the correct flip",async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:-100,y:0},100,1,true,false,0,{flip:true,facing:"left",resume:false});
  assert.equal(f.live()[0].scale.x,2);await f.motor.tick(1000);assert.equal(f.live()[0].scale.x,-2);
});
test("stop and resume on the return leg keeps moving home",async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0,{flip:true,facing:"right",resume:true});
  await f.motor.tick(1000);await f.motor.tick(1500);await f.motor.stop();
  assert.equal(f.items()[0].position.x,50);
  await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,2000,{flip:true,facing:"right",resume:true});
  assert.equal(f.live()[0].scale.x,-2);await f.motor.tick(2500);assert.equal(f.live()[0].position.x,0);
});
test("vertical routes flip on return and keep the flip when resumed",async()=>{
  const f=fixture();await f.motor.start(f.initial,{x:0,y:100},100,1,true,false,0,{flip:true,facing:"right",resume:true});
  await f.motor.tick(1000);await f.motor.tick(1500);await f.motor.stop();
  assert.equal(f.items()[0].scale.x,-2);
  await f.motor.start(f.initial,{x:0,y:100},100,1,true,false,2000,{flip:true,facing:"right",resume:true});assert.equal(f.live()[0].scale.x,-2);
});

test("switching a paused return leg to one-way heads toward B",async()=>{
  const f=fixture();const options={flip:true,facing:"right" as const,resume:true};
  await f.motor.start(f.initial,{x:100,y:0},100,1,true,false,0,options);
  await f.motor.tick(1000);await f.motor.tick(1500);await f.motor.stop();
  await f.motor.start(f.initial,{x:100,y:0},100,1,false,false,2000,options);
  assert.equal(f.motor.direction,"outbound");assert.equal(f.live()[0].scale.x,2);
  await f.motor.tick(2500);assert.equal(f.items()[0].position.x,100);assert.equal(f.motor.running,false);
});
test("disabled flip preserves already mirrored artwork",async()=>{
  const f=fixture(-2);
  await f.motor.start(f.initial,{x:-100,y:0},100,1,true,false,0);
  await f.motor.tick(1000);assert.equal(f.live()[0].scale.x,-2);
});
test("non-image items move but are not flipped",async()=>{
  const f=fixture(2,"SHAPE");await f.motor.start(f.initial,{x:-100,y:0},100,1,true,false,0,{flip:true,facing:"right",resume:true});
  await f.motor.tick(500);assert.equal(f.live()[0].position.x,-50);assert.equal(f.live()[0].scale.x,2);
});
