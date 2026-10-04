import test from 'node:test';import assert from 'node:assert/strict';import {runInNewContext} from 'node:vm';import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../public/assets/theme.js',import.meta.url),'utf8');
function setup(saved:string|null=null,dark=false,blocked=false){
 const data:Record<string,string>={},storage=new Map<string,string>(saved?[['mory-cms-theme',saved]]:[]),listeners=new Map<string,Function[]>();let mediaChange:Function=()=>{};
 const media={matches:dark,addEventListener:(_name:string,fn:Function)=>{mediaChange=fn;}};
 const window={addEventListener:(name:string,fn:Function)=>listeners.set(name,[...listeners.get(name)??[],fn]),dispatchEvent:(event:any)=>{for(const fn of listeners.get(event.type)??[])fn(event);}};
 runInNewContext(script,{window,document:{documentElement:{dataset:data}},matchMedia:()=>media,localStorage:{getItem:(key:string)=>{if(blocked)throw new Error('blocked');return storage.get(key)??null;},setItem:(key:string,value:string)=>{if(blocked)throw new Error('blocked');storage.set(key,value);}},Event:class{constructor(public type:string){}}});
 return {data,storage,set:(value:string)=>window.dispatchEvent({type:'mory-cms-theme-set',detail:value}),os:(value:boolean)=>{media.matches=value;mediaChange();},external:(value:string|null)=>{if(value)storage.set('mory-cms-theme',value);else storage.delete('mory-cms-theme');window.dispatchEvent({type:'storage',key:'mory-cms-theme'});}};
}
test('CMS defaults to system and follows OS changes',()=>{const f=setup();assert.equal(f.data.themePreference,'system');assert.equal(f.data.theme,'light');f.os(true);assert.equal(f.data.theme,'dark');});
test('CMS retains existing explicit preferences and persists all three choices',()=>{const f=setup('dark');assert.equal(f.data.theme,'dark');f.set('light');f.os(true);assert.equal(f.data.theme,'light');assert.equal(f.storage.get('mory-cms-theme'),'light');f.set('system');assert.equal(f.data.theme,'dark');assert.equal(f.storage.get('mory-cms-theme'),'system');});
test('CMS stored system resolves before rendering, rather than setting a system color theme',()=>{const f=setup('system',true);assert.equal(f.data.theme,'dark');assert.equal(f.data.themePreference,'system');});
test('CMS synchronizes preference across tabs',()=>{const f=setup();f.external('dark');assert.equal(f.data.theme,'dark');f.external(null);assert.equal(f.data.themePreference,'system');});
test('CMS invalid or unavailable storage safely follows the OS',()=>{for(const f of [setup('invalid',true),setup(null,true,true)]){assert.equal(f.data.theme,'dark');f.set('light');assert.equal(f.data.theme,'light');}});
