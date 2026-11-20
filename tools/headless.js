global.window=global;require('../core.js');require('../factions.js');require('../engine.js');
const lists=[];for(const f of TC.FACTIONS)for(const l of f.lists)lists.push(Object.assign({faction:f.id},l));
const unknown={};const stats={};let logs=[];
const ui={roll:async()=>{},log:(k,t)=>{logs.push(t)},thought:t=>logs.push('  ~'+t),anim:()=>Promise.resolve(),update(){},moveAlong:async()=>{},afterDeploy:async()=>{},turnBanner(){},select(){},gameOver(){}};
// model build check
for(const l of lists){for(const e of l.models){const m=TC.buildModel(e,l,0);if(!m){unknown['MODEL '+l.id+':'+e.model]=1;continue;}for(const q of m.equipment)if(q.unknown)unknown[q.name+' ('+l.id+')']=1; if(!m.weapons.length)unknown['NOWEAPON '+l.id+':'+m.label]=1;}}
console.log('UNKNOWN',Object.keys(unknown).join('\n'));
(async()=>{const N=+process.argv[2]||60;const wins=lists.map(()=>[0,0]);const t0=Date.now();
for(let g=0;g<N;g++){const a=g%lists.length,b=(g*7+3)%lists.length;logs=[];
 const game=new TC.Game({lists:[lists[a],lists[b]],ui,seed:1000+g});
 try{await game.run();}catch(e){console.log('ERR',lists[a].id,lists[b].id,e.stack.split('\n').slice(0,4).join(' | '));console.log(logs.slice(-6).join('\n'));continue;}
 wins[a][1]++;wins[b][1]++;if(game.winner===0)wins[a][0]++;if(game.winner===1)wins[b][0]++;
 if(g<2)console.log(logs.slice(0,80).join('\n'));
}
console.log('ms/game',(Date.now()-t0)/N);lists.forEach((l,i)=>console.log(l.id,wins[i].join('/')));})();
