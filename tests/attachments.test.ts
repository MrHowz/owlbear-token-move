import {test} from "node:test";
import assert from "node:assert/strict";
import type {Item} from "@owlbear-rodeo/sdk";
import {selectionRoots,followAttachments} from "../src/attachments";
const item=(id:string,x:number,y:number,attachedTo?:string)=>({id,type:"IMAGE",position:{x,y},rotation:0,scale:{x:1,y:1},locked:false,attachedTo} as Item);
test("selecting a nested child resolves its root and selecting the whole set controls it once",()=>{
 const a=item("a",0,0),b=item("b",100,0,"a"),c=item("c",110,0,"b");assert.deepEqual(selectionRoots([c],[a,b,c]).map(i=>i.id),["a"]);assert.deepEqual(selectionRoots([c,a,b],[a,b,c]).map(i=>i.id),["a"]);
 a.locked=true;assert.throws(()=>selectionRoots([b],[a,b,c]),/ปลดล็อก/);
});
test("missing and cyclic attachment chains fail before animation starts",()=>{
 const a=item("a",0,0,"b"),b=item("b",0,0,"a");assert.throws(()=>selectionRoots([a],[a]),/ไม่พบ/);assert.throws(()=>selectionRoots([a],[a,b]),/วงวน/);
});
test("live LINE transforms include nested children exactly once regardless of scene order",()=>{
 const old=[item("child",100,0,"parent"),item("grandchild",110,0,"child"),item("parent",0,0)];const next=structuredClone(old);next[2].position={x:200,y:100};followAttachments(next,old,new Set(["parent"]));assert.deepEqual(next[0].position,{x:300,y:100});assert.deepEqual(next[1].position,{x:310,y:100});assert.equal(next[0].attachedTo,"parent");
});
test("rotation, scale and attachment opt-outs are respected in the interaction preview",()=>{
 const old=[item("parent",0,0),item("child",100,0,"parent"),item("fixed",0,100,"parent")];old[2].disableAttachmentBehavior=["POSITION","ROTATION","SCALE"];
 const next=structuredClone(old);next[0].position={x:10,y:20};next[0].rotation=90;next[0].scale={x:2,y:2};followAttachments(next,old,new Set(["parent"]));assert.ok(Math.abs(next[1].position.x-10)<1e-7);assert.equal(next[1].position.y,220);assert.equal(next[1].rotation,90);assert.deepEqual(next[1].scale,{x:2,y:2});assert.deepEqual(next[2].position,old[2].position);assert.equal(next[2].rotation,0);
});
