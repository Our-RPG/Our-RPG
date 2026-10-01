// ===== world map rendering and map query helpers =====
"use strict";

// Callers (1):
//  world.js:25
function createWorldMap(ctx) {
  const {
    S, hash2i, rand2, fbm, elevation, temperature, humidity, biomeAtTile, classify,
    civField, weirdField, farmField, personalityAt, riversNear, roadsNear, getChunk, ROAD_W,
    villagesNearForMap, poisNearForMap, iconsNearForMap, macroPixels,
  } = ctx;
  // carved labyrinth hedges (labgen.js) — SAME instance parameters as
  // chunks.js, so the map mirrors the stamped walls tile-for-tile
  const labMaze = createLabMaze(hash2i, rand2, S);
  // Biome color palette (Map.html COLORS array, 37 biomes)
  const MAP_COLORS = [
    [66,88,134],[100,124,162],[199,183,143],[93,122,62],[72,104,54],[94,106,72],
    [197,172,113],[110,104,95],[222,225,228],[150,159,138],[152,132,76],[162,120,82],
    [44,90,40],[110,140,70],[164,154,86],[126,122,106],[148,150,120],[56,50,48],
    [96,88,76],[88,112,88],[88,138,72],[90,140,160],[136,130,112],[220,218,206],
    [76,112,88],[170,108,68],[152,146,90],[186,106,60],[112,98,120],[182,174,152],
    [92,124,116],[94,90,86],[118,102,108],[202,218,230],[124,150,72],[124,140,94],
    [152,142,170],
  ];
  const MAP_PATH = [158,139,104], MAP_BRIDGE = [122,96,58];
  const MAP_WATER = [[50,70,114],[72,94,140],[98,124,164],[138,164,194]];

  // Biome names for hover tooltip
  const BIOME_NAMES = ["Deep Sea","Sea","Beach","Plains","Forest","Swamp",
    "Desert","Mountains","Snowy Peaks","Frozen Wastes","Farmland","Badlands",
    "Jungle","Meadow","Savanna","Rockyland","Labyrinth","Volcano","Wilderness",
    "Taiga","Oasis","Coral Reef","Ruins","Salt Flats","Wetlands","Canyon",
    "Steppe","Red Desert","Giant Mushroom Forest","Bone Fields","Dream Forest",
    "Ashen Forest","Heather Moor","Glacier","Bamboo Grove","Blossom Grove","Crystal Fields"];

  // -- drawing helpers (ported from Map.html) --
  function mStar4(g, cx, cy, ro, ri) {
    g.beginPath();
    for (let i=0; i<8; i++) {
      const r=i%2===0?ro:ri, a=(i/8)*Math.PI*2-Math.PI/2;
      g[i===0?'moveTo':'lineTo'](cx+Math.cos(a)*r, cy+Math.sin(a)*r);
    }
    g.closePath();
  }
  function mDrawBld(ctx, x, y, w, h, fill, dashed) {
    ctx.fillStyle=fill; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#3a352a'; ctx.lineWidth=1.5;
    if(dashed) ctx.setLineDash([3,2]);
    ctx.strokeRect(x+0.75,y+0.75,w-1.5,h-1.5);
    ctx.setLineDash([]);
  }
  function mDrawWheat(ctx, x, y, w, h) {
    ctx.fillStyle='#c2a244'; ctx.fillRect(x,y,w,h);
    ctx.fillStyle='#a2823a';
    for(let yy=y+2; yy<y+h-1; yy+=4) ctx.fillRect(x,yy,w,2);
    ctx.strokeStyle='#6e5227'; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
  }
  function mDrawTree(ctx, x, y, rad, dark, light) {
    ctx.fillStyle=dark||'#1c4a20';
    ctx.beginPath(); ctx.arc(x,y,rad,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=light||'#2f6b2c';
    ctx.beginPath(); ctx.arc(x-rad*0.25,y-rad*0.25,rad*0.62,0,Math.PI*2); ctx.fill();
  }
  function mDrawConifer(ctx, x, y) {
    ctx.fillStyle='#1f4534';
    ctx.beginPath(); ctx.moveTo(x,y-4.5); ctx.lineTo(x-3,y+3); ctx.lineTo(x+3,y+3); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#31614a';
    ctx.beginPath(); ctx.moveTo(x,y-3); ctx.lineTo(x-1.8,y+1.8); ctx.lineTo(x+1.8,y+1.8); ctx.closePath(); ctx.fill();
  }
  function mDrawDeadTree(ctx, x, y) {
    ctx.strokeStyle='#4a3b26'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(x,y+3); ctx.lineTo(x,y-2);
    ctx.moveTo(x,y-0.5); ctx.lineTo(x-2.4,y-3);
    ctx.moveTo(x,y-1.5); ctx.lineTo(x+2.2,y-3.4); ctx.stroke();
  }
  function mDrawPuddle(ctx, x, y) {
    ctx.fillStyle='#414c3a'; ctx.beginPath(); ctx.ellipse(x,y,3.2,2.1,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#37422f'; ctx.beginPath(); ctx.ellipse(x+0.5,y+0.4,1.8,1.1,0,0,Math.PI*2); ctx.fill();
  }
  // Draw a sprite from items32.png (16 cols × 18 rows, 32px + 1px gap)
  function mSpr(ctx, x, y, c, r, sz) {
    const img = typeof IMGS !== 'undefined' && IMGS['i'];
    if (!img || !img.complete || img.naturalWidth === 0) return;
    ctx.drawImage(img, c * 33, r * 33, 32, 32, x - sz * 0.5, y - sz * 0.5, sz, sz);
  }

  function mDrawPoi(ctx, p, baseX, baseY, TILE) {
    const ox=(p.x-baseX)*TILE, oy=(p.y-baseY)*TILE;
    const h=s=>rand2(p.x,p.y,S^s);
    switch(p.type) {
      case 'shack': mDrawBld(ctx,ox-6,oy-4,12,9,'#8a6f4d'); break;
      case 'farmstead':
        mDrawWheat(ctx,ox-14,oy+4,26,14); mDrawWheat(ctx,ox+4,oy-12,16,12);
        mDrawBld(ctx,ox-12,oy-10,12,10,'#a99877'); mDrawBld(ctx,ox+2,oy-8,10,8,'#8a5f3d'); break;
      case 'windmill':
        mDrawBld(ctx,ox-5,oy-5,10,10,'#9a8a6a');
        ctx.strokeStyle='#4a4030'; ctx.lineWidth=1.6;
        ctx.beginPath(); ctx.moveTo(ox-9,oy-9); ctx.lineTo(ox+9,oy+9); ctx.moveTo(ox-9,oy+9); ctx.lineTo(ox+9,oy-9); ctx.stroke(); break;
      case 'manor':
        mDrawBld(ctx,ox-14,oy-9,28,18,'#6f6a60',true); mDrawBld(ctx,ox-14,oy-9,9,24,'#6f6a60',true);
        for(let i=0;i<4;i++) { const a=h(0x9301+i)*Math.PI*2; mDrawDeadTree(ctx,ox+Math.cos(a)*(18+i*3),oy+Math.sin(a)*(14+i*2)); } break;
      case 'guild':
        mDrawBld(ctx,ox-10,oy-8,20,16,'#7d718d');
        ctx.strokeStyle='#2c2a24'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.moveTo(ox+8,oy-8); ctx.lineTo(ox+8,oy-17); ctx.stroke();
        ctx.fillStyle='#c8b048'; ctx.fillRect(ox+8,oy-17,6,4); break;
      case 'ruins':
        for(let i=0;i<6;i++) {
          const a=i/6*Math.PI*2+h(0x9310)*2, px2=ox+Math.cos(a)*9, py2=oy+Math.sin(a)*7;
          if(h(0x9311+i)<0.7) { ctx.fillStyle='#9a948a'; ctx.beginPath(); ctx.arc(px2,py2,1.9,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#4e4a42'; ctx.lineWidth=1; ctx.stroke(); }
          else { ctx.strokeStyle='#8a847a'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(px2-2.5,py2); ctx.lineTo(px2+2.5,py2+1); ctx.stroke(); }
        } break;
      case 'watchtower': mDrawBld(ctx,ox-5,oy-5,10,10,'#85816f'); ctx.fillStyle='#4e4a42'; ctx.fillRect(ox-1.5,oy-1.5,3,3); break;
      case 'orchard':
        ctx.strokeStyle='#6e5227'; ctx.lineWidth=1; ctx.strokeRect(ox-16,oy-12,32,24);
        for(let gy2=0;gy2<2;gy2++) for(let gx2=0;gx2<3;gx2++) mDrawTree(ctx,ox-10+gx2*10,oy-5+gy2*11,3.2,'#2a6428','#3f8a38'); break;
      case 'graveyard':
        for(let i=0;i<6;i++) {
          const gx2=ox-10+(i%3)*9+(h(0x9320+i)-0.5)*4, gy2=oy-6+((i/3)|0)*10+(h(0x9326+i)-0.5)*4;
          ctx.fillStyle='#9a948a'; ctx.fillRect(gx2-1,gy2-2,2.5,4); ctx.strokeStyle='#4e4a42'; ctx.lineWidth=0.8; ctx.strokeRect(gx2-1,gy2-2,2.5,4);
        }
        mDrawDeadTree(ctx,ox+12,oy-8); break;
      case 'campsite':
        ctx.fillStyle='#c8b48a'; ctx.strokeStyle='#3a352a'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.moveTo(ox-3,oy-5); ctx.lineTo(ox-8,oy+3); ctx.lineTo(ox+2,oy+3); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#e87820'; ctx.beginPath(); ctx.arc(ox+6,oy+1,1.8,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#b03818'; ctx.beginPath(); ctx.arc(ox+6,oy+1,0.9,0,Math.PI*2); ctx.fill(); break;
      case 'fairyring':
        for(let i=0;i<8;i++) {
          const a=i/8*Math.PI*2;
          ctx.fillStyle=i%2?'#e8e2d2':'#c44438'; ctx.beginPath(); ctx.arc(ox+Math.cos(a)*5.5,oy+Math.sin(a)*4.5,1.2,0,Math.PI*2); ctx.fill();
        } break;
      case 'standing':
        ctx.fillStyle='#6a655c'; ctx.fillRect(ox-2,oy-4,4,8); ctx.strokeStyle='#35322a'; ctx.lineWidth=1; ctx.strokeRect(ox-2,oy-4,4,8);
        ctx.fillStyle='#8a847a'; ctx.fillRect(ox-1,oy-3,1.5,6); break;
      case 'obelisk':
        ctx.fillStyle='#c0a060'; ctx.strokeStyle='#3a352a'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(ox,oy-6); ctx.lineTo(ox+3,oy+4); ctx.lineTo(ox-3,oy+4); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'wizardtower':
        ctx.fillStyle='#85816f'; ctx.strokeStyle='#35322a'; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.arc(ox,oy,6,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#4a5a9a'; ctx.beginPath(); ctx.arc(ox,oy,3.2,0,Math.PI*2); ctx.fill(); break;
      case 'minecamp':
        ctx.fillStyle='#151210'; ctx.strokeStyle='#4e4a42'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(ox-5,oy+4); ctx.lineTo(ox-5,oy-1); ctx.arc(ox,oy-1,5,Math.PI,0); ctx.lineTo(ox+5,oy+4); ctx.closePath(); ctx.fill(); ctx.stroke();
        mDrawBld(ctx,ox+7,oy-2,6,6,'#8a5f3d'); break;
      case 'lighthouse':
        ctx.fillStyle='#e8e2d2'; ctx.strokeStyle='#35322a'; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.arc(ox,oy,5,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#c03828'; ctx.beginPath(); ctx.arc(ox,oy,2.4,0,Math.PI*2); ctx.fill(); break;
      case 'pond':
        ctx.fillStyle='rgb(32,46,68)'; ctx.beginPath(); ctx.ellipse(ox,oy,9,6.5,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=`rgb(${MAP_WATER[3].join(',')})`; ctx.beginPath(); ctx.ellipse(ox,oy,7.5,5,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=`rgb(${MAP_WATER[2].join(',')})`; ctx.beginPath(); ctx.ellipse(ox+1,oy+0.5,3.5,2.2,0,0,Math.PI*2); ctx.fill(); break;
      case 'lumbercamp':
        for(const [sx,sy] of [[-7,-3],[-2,4]]) {
          ctx.fillStyle='#8a5f3d'; ctx.beginPath(); ctx.arc(ox+sx,oy+sy,2,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#c8a878'; ctx.beginPath(); ctx.arc(ox+sx,oy+sy,1,0,Math.PI*2); ctx.fill();
        }
        ctx.fillStyle='#7a5230'; ctx.strokeStyle='#3a352a'; ctx.lineWidth=0.8;
        for(let i=0;i<3;i++) { ctx.fillRect(ox+2,oy-4+i*3,9,2.4); ctx.strokeRect(ox+2,oy-4+i*3,9,2.4); } break;
      case 'shrine':
        mDrawBld(ctx,ox-4,oy-4,8,8,'#b0aa9a');
        ctx.fillStyle='#ffd23a'; mStar4(ctx,ox,oy,3,1.2); ctx.fill(); break;
      case 'inn':
        mDrawBld(ctx,ox-8,oy-5,16,10,'#a99877');
        ctx.strokeStyle='#2c2a24'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.moveTo(ox+10,oy+5); ctx.lineTo(ox+10,oy-4); ctx.stroke();
        ctx.fillStyle='#c8b048'; ctx.fillRect(ox+8.5,oy-8,5,4); break;
      case 'watermill':
        mDrawBld(ctx,ox-9,oy-5,12,10,'#8a6f4d');
        ctx.strokeStyle='#4a4030'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(ox+7,oy,4.5,0,Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox+2.5,oy); ctx.lineTo(ox+11.5,oy); ctx.moveTo(ox+7,oy-4.5); ctx.lineTo(ox+7,oy+4.5); ctx.stroke(); break;
      case 'greatlab':
        // the Great Labyrinth: nested stone squares + the entrance gap south
        ctx.strokeStyle='#8a8a80'; ctx.lineWidth=2.6;
        for(const s of [26,17,8]) ctx.strokeRect(ox-s/2,oy-s/2,s,s);
        ctx.strokeStyle=`rgb(${MAP_PATH.join(',')})`; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(ox,oy+13); ctx.lineTo(ox,oy+8); ctx.stroke(); break;
      case 'maze':
        ctx.strokeStyle='#2a6428'; ctx.lineWidth=2.2;
        for(const s of [24,16,8]) ctx.strokeRect(ox-s/2,oy-s/2,s,s);
        ctx.strokeStyle=`rgb(${MAP_PATH.join(',')})`; ctx.lineWidth=2.6;
        ctx.beginPath(); ctx.moveTo(ox+(h(0x9330)<0.5?-4:4),oy-12); ctx.lineTo(ox+(h(0x9330)<0.5?-4:4),oy-7);
        ctx.moveTo(ox-12,oy+(h(0x9331)<0.5?-3:3)); ctx.lineTo(ox-7,oy+(h(0x9331)<0.5?-3:3)); ctx.stroke(); break;
      case 'battlefield':
        ctx.strokeStyle='#b8b4a8'; ctx.lineWidth=1.3;
        for(const [cx2,cy2] of [[-7,-3],[3,2],[-1,-7]]) {
          ctx.beginPath(); ctx.moveTo(ox+cx2-3,oy+cy2-3); ctx.lineTo(ox+cx2+3,oy+cy2+3);
          ctx.moveTo(ox+cx2+3,oy+cy2-3); ctx.lineTo(ox+cx2-3,oy+cy2+3); ctx.stroke();
        }
        ctx.fillStyle='#9a948a'; ctx.fillRect(ox+7,oy+4,2.5,4); break;
      case 'arena':
        ctx.strokeStyle='#85816f'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(ox,oy,9,0.35,Math.PI*2-0.35); ctx.stroke();
        ctx.strokeStyle='#35322a'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.arc(ox,oy,10.5,0.35,Math.PI*2-0.35); ctx.stroke(); break;
      case 'barrow':
        ctx.fillStyle='#7a6a4c'; ctx.strokeStyle='#3a352a'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.ellipse(ox,oy,9,6,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#5c5240'; ctx.beginPath(); ctx.ellipse(ox,oy-1,5,3,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#151210'; ctx.fillRect(ox-1.5,oy+3,3,3); break;
      case 'crater':
        ctx.strokeStyle='#4a4038'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.ellipse(ox,oy,8,6,0,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle='#35302c'; ctx.beginPath(); ctx.ellipse(ox,oy,4,3,0,0,Math.PI*2); ctx.fill(); break;
      case 'hotspring':
        ctx.fillStyle='#78b8d8'; ctx.strokeStyle='#2c4a5a'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.ellipse(ox,oy+1,5,3.5,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle='#d8dee2'; ctx.lineWidth=1.1;
        ctx.beginPath(); for(const dx of [-3,0,3]) { ctx.moveTo(ox+dx,oy-3); ctx.quadraticCurveTo(ox+dx+1.5,oy-5,ox+dx,oy-7); } ctx.stroke(); break;
      case 'stonecircle':
        for(let i=0;i<7;i++) {
          const a=i/7*Math.PI*2+h(0x9350), sx=ox+Math.cos(a)*8, sy=oy+Math.sin(a)*6;
          ctx.fillStyle='#6a655c'; ctx.fillRect(sx-1.4,sy-2.6,2.8,5.2); ctx.strokeStyle='#35322a'; ctx.lineWidth=0.8; ctx.strokeRect(sx-1.4,sy-2.6,2.8,5.2);
        } break;
      case 'fishvillage': {
        const [dx,dy]=p.dir||[0,-1];
        const s0=Math.max(0,(p.shore||4)-3)*TILE, s1=((p.shore||4)+4)*TILE;
        ctx.lineCap='butt';
        for(const [w,c] of [[4.5,'#2c2418'],[2.5,'#7a5a32']]) {
          ctx.strokeStyle=c; ctx.lineWidth=w;
          ctx.beginPath(); ctx.moveTo(ox+dx*s0,oy+dy*s0); ctx.lineTo(ox+dx*s1,oy+dy*s1); ctx.stroke();
        }
        const px3=-dy, py3=dx;
        for(let i=-1;i<=1;i++) mDrawBld(ctx,ox+px3*i*13-dx*8-5,oy+py3*i*13-dy*8-4,10,8,'#8a6f4d');
        break;
      }
      case 'gallows':
        ctx.strokeStyle='#4a3b26'; ctx.lineWidth=1.8;
        ctx.beginPath(); ctx.moveTo(ox-3,oy+5); ctx.lineTo(ox-3,oy-6); ctx.lineTo(ox+4,oy-6); ctx.stroke();
        ctx.strokeStyle='#8a847a'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(ox+3,oy-6); ctx.lineTo(ox+3,oy-2); ctx.stroke();
        ctx.beginPath(); ctx.arc(ox+3,oy-1,1.2,0,Math.PI*2); ctx.stroke(); break;
      case 'geyser':
        ctx.fillStyle='#78b8d8'; ctx.strokeStyle='#2c4a5a'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.ellipse(ox,oy+2,4,2.6,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle='#e8f2f8'; ctx.lineWidth=1.6;
        ctx.beginPath(); ctx.moveTo(ox,oy+1); ctx.lineTo(ox,oy-7); ctx.stroke();
        ctx.fillStyle='#e8f2f8';
        for(const [ddx,ddy] of [[-2,-6],[2,-6],[0,-9]]) { ctx.beginPath(); ctx.arc(ox+ddx,oy+ddy,1.1,0,Math.PI*2); ctx.fill(); } break;
      case 'beacon':
        ctx.fillStyle='#6a5a42'; ctx.strokeStyle='#2c2a24'; ctx.lineWidth=1;
        ctx.fillRect(ox-2,oy-3,4,7); ctx.strokeRect(ox-2,oy-3,4,7);
        ctx.fillStyle='#e87820'; ctx.beginPath(); ctx.arc(ox,oy-5,2.2,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#f8c848'; ctx.beginPath(); ctx.arc(ox,oy-5.5,1.1,0,Math.PI*2); ctx.fill(); break;
      case 'portal':
        ctx.strokeStyle='#9040c0'; ctx.lineWidth=2.4;
        ctx.beginPath(); ctx.ellipse(ox,oy,4,5.5,0,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle='#d0a0e8'; ctx.beginPath(); ctx.ellipse(ox,oy,1.8,3,0,0,Math.PI*2); ctx.fill(); break;
      case 'hermitage':
        mDrawBld(ctx,ox-4,oy-3,9,7,'#8a7a5a'); mDrawConifer(ctx,ox+8,oy-2); mDrawConifer(ctx,ox-8,oy+3); break;
      case 'tarpit':
        ctx.fillStyle='#1c1a18'; ctx.strokeStyle='#4a4640'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.ellipse(ox-3,oy-1,5.5,3.5,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(ox+5,oy+3,3.5,2.2,0,0,Math.PI*2); ctx.fill(); ctx.stroke(); break;
      case 'statue':
        ctx.fillStyle='#9a948a'; ctx.strokeStyle='#35322a'; ctx.lineWidth=1;
        ctx.fillRect(ox-4,oy+2,8,3); ctx.strokeRect(ox-4,oy+2,8,3);
        ctx.fillRect(ox-1.5,oy-3,3,5);
        ctx.beginPath(); ctx.arc(ox,oy-4.5,1.8,0,Math.PI*2); ctx.fill(); break;
      case 'shipwreck':
        ctx.strokeStyle='#4a3520'; ctx.lineWidth=2.2;
        ctx.beginPath(); ctx.arc(ox,oy-3,8,0.35,Math.PI-0.35); ctx.stroke();
        ctx.lineWidth=1.1;
        ctx.beginPath(); for(const ddx of [-4,0,4]) { ctx.moveTo(ox+ddx,oy+3); ctx.lineTo(ox+ddx,oy-1); }
        ctx.moveTo(ox+2,oy-1); ctx.lineTo(ox+7,oy-8); ctx.stroke(); break;
      case 'wishingwell':
        ctx.fillStyle='#8a847a'; ctx.strokeStyle='#35322a'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.arc(ox,oy,3.5,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle=`rgb(${MAP_WATER[2].join(',')})`; ctx.beginPath(); ctx.arc(ox,oy,1.8,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#6a4a2a'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(ox-4,oy-1); ctx.lineTo(ox-4,oy-6); ctx.lineTo(ox,oy-8); ctx.lineTo(ox+4,oy-6); ctx.lineTo(ox+4,oy-1); ctx.stroke(); break;
      case 'observatory':
        ctx.fillStyle='#85816f'; ctx.strokeStyle='#35322a'; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.arc(ox,oy,6.5,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#c8ccd4'; ctx.beginPath(); ctx.arc(ox,oy,4,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#35322a'; ctx.lineWidth=1.1;
        ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(ox+4.5,oy-4.5); ctx.stroke(); break;
      case 'totem':
        for(const [dy2,c] of [[3,'#b84040'],[0,'#3a8a8a'],[-3,'#c8a838']]) {
          ctx.fillStyle=c; ctx.fillRect(ox-1.5,oy+dy2-1.5,3,3);
        }
        ctx.strokeStyle='#2c2a24'; ctx.lineWidth=1; ctx.strokeRect(ox-1.5,oy-4.5,3,9); break;
      case 'apiary':
        for(const dx of [-6,1]) mDrawBld(ctx,ox+dx,oy-3,5,5,'#e8e2d2'); break;
      case 'vineyard':
        ctx.strokeStyle='#6e5227'; ctx.lineWidth=1; ctx.strokeRect(ox-14,oy-10,28,20);
        for(let row=0;row<3;row++) {
          const ry=oy-6+row*6;
          ctx.strokeStyle='#4a7a34'; ctx.lineWidth=1.6;
          ctx.beginPath(); ctx.moveTo(ox-11,ry); ctx.lineTo(ox+11,ry); ctx.stroke();
          ctx.fillStyle='#7a4890';
          for(let gg=0;gg<4;gg++) { ctx.beginPath(); ctx.arc(ox-8+gg*5.5,ry+1.2,0.9,0,Math.PI*2); ctx.fill(); }
        } break;
      case 'garden': {
        ctx.strokeStyle='#6e5227'; ctx.lineWidth=1; ctx.strokeRect(ox-12,oy-8,24,16);
        const gcols=['#d8c23a','#c4453a','#e8e2d2','#9058b0','#e88030'];
        for(let i=0;i<10;i++) {
          ctx.fillStyle=gcols[(i+(h(0x9340)*5|0))%5]; ctx.fillRect(ox-9+(i%5)*4.5,oy-4+((i/5)|0)*8,2,2);
        } break;
      }
    }
  }

  // ---- overview / macro LOD tier (ported from Map.html ~line 3160+) ----
  // Map.html never bakes full-detail chunk canvases when zoomed way out —
  // below OVERVIEW_ZOOM it draws coarse "macro" tiles instead, sampling the
  // same elevation/classify pipeline at a stride of 2/4/8 units instead of 1,
  // so a huge zoomed-out view costs a handful of cheap 64px tiles instead of
  // hundreds of expensive 256px chunk bakes. Ported here so a cheat-mode
  // "whole world" zoom-out is cheap the same way. Coordinate note: Map.html's
  // own "tile"/TILE=4 unit IS this file's "map-coord" unit (1 map-coord = 2
  // game tiles — same convention renderMapChunk already uses via hgx=gwx*0.5),
  // NOT a raw game tile — so thresholds below are converted from Map.html's
  // zoom (px per map-coord / 4) into wm.zoom (px per GAME tile) by the factor
  // 4/2=2, e.g. Map.html's OVERVIEW_ZOOM=0.3 -> 0.3*4/2 = 0.6 here.
  // NOTE: this is NOT Map.html's own OVERVIEW_ZOOM*2 conversion (that gave
  // 0.6) — measured against THIS renderer's actual cost instead. Profiling
  // showed renderMapChunk's own terrain/classify loop is cheap (~8ms/chunk);
  // the real cost on a fresh viewport is riversNear/roadsNear/villagesNear/
  // poisNear — each searches a radius (RIV_RANGE ~1264 map-coord units) far
  // wider than one chunk, and generating a never-before-seen river/road cell
  // runs real A*-style pathfinding (see features.js gridRoute/riverTrace).
  // That generation cost is pre-existing and engine-wide — chunks.js's own
  // 3D chunk gen pays the same cost on a player's first visit to new terrain
  // (chunks.js:309-310) — so it's out of scope to rewrite here. mapRegionQuery
  // (below) removes the *redundant* part (every chunk in a viewport used to
  // redo this ~180-cell search independently; now the viewport queries once
  // and shares the result), but a synchronous draw still touches however many
  // distinct river/road cells a huge viewport's combined area spans. Since
  // wmDraw() must bake the whole viewport with no queue, the only remaining
  // lever is bounding how large that area is allowed to get before falling
  // back to macro tiles (which touch zero river/road/village/POI generation
  // by construction) — so this is set high enough that default/typical
  // exploring zoom (~1-6) stays on the cheap macro tier, and full detail is
  // reserved for zoom levels where the on-screen chunk count is small.
  const OVERVIEW_Z = 8;          // wm.zoom below this -> macro tier
  const MACRO_PX = 64;           // px per macro-tile canvas side
  const MACRO_CACHE_MAX = 1600;   // bulk hydration holds the full set (64px bitmaps, ~16KB each)   // same bounded-LRU discipline as MAP_CACHE_CAP
  const macroCache = new Map();
  // Finer sampling the closer we are, so a macro pixel stays ~1-2 screen px:
  // 1 map-coord unit = 2 game tiles = 2z screen px, so step ~= 1/z keeps a
  // macro pixel roughly constant-size on screen across the whole (now much
  // wider, since OVERVIEW_Z=8) macro-tier zoom range — otherwise the fixed
  // MACRO_PX=64 source canvas would look visibly blocky/upscaled right below
  // the boundary the way the old ladder (capped at step=2) would have if
  // reused unchanged for zoom up to 8.
  function overviewStep(z) {
    return z>=4?0.25 : z>=2?0.5 : z>=1?1 : z>=0.5?2 : z>=0.25?4 : z>=0.1?8 : 16;
  }
  function _macroCacheSet(key, cv) {
    if (!macroCache.has(key) && macroCache.size >= MACRO_CACHE_MAX)
      macroCache.delete(macroCache.keys().next().value);
    macroCache.set(key, cv);
  }
  // mx,my: macro-tile grid index in MAP-COORD units; step: map-coord units
  // sampled per macro pixel (coarser than renderMapChunk's per-tile sampling)
  // pixel math lives in features.js macroPixels (shared with the road worker,
  // which renders macro tiles off-thread — see the "macro" worker message)
  // --- which side of the isle SEAL does the macro painter draw for? ---
  // Macro tiles are pure terrain, so a tile straddling the seal exists in
  // two truths: the isle visible (for the character living its tutorial —
  // and for the Bifrost takeoff bake) or masked to deep sea (for everyone
  // in the wide world). The viewer's side picks the variant at RENDER time;
  // _macroIsleView lets the Bifrost cinematic pin "isle visible" across the
  // graduation teleport (start() sets it, its cleanup clears it and drops
  // the seal's tiles). Sharing the plain cache key is safe because the only
  // side flips are graduation (tutorial.js graduateCore purges the seal
  // rect via mapDropRect) and a character reset (a full page reload).
  let _macroIsleView = null;             // null = follow the player's side
  function setMacroIsleView(v) { _macroIsleView = v; }
  function _viewShowIsle() {
    if (_macroIsleView !== null) return _macroIsleView;
    return typeof inTutSeal === "function" && typeof player !== "undefined" && player &&
      inTutSeal(player.x, player.y);
  }
  function renderMacro(step, mx, my) {
    const cv = document.createElement('canvas');
    cv.width = MACRO_PX; cv.height = MACRO_PX;
    cv.getContext('2d').putImageData(
      new ImageData(macroPixels(step, mx, my, MACRO_PX, MAP_COLORS, MAP_WATER, _viewShowIsle()), MACRO_PX, MACRO_PX), 0, 0);
    return cv;
  }
  // Fully synchronous, no throttling: wmDraw() must complete the ENTIRE
  // viewport on the draw call that needs it — no queue, no placeholder that
  // fills in over subsequent frames. The macroCache above is purely a
  // re-visit speedup; a genuinely new tile always renders inline, right here.
  function getMacro(step, mx, my) {
    const key = step + ':' + mx + ',' + my;
    const c = macroCache.get(key);
    if (c) return c;
    const cv = renderMacro(step, mx, my);
    _macroCacheSet(key, cv);
    persistMacro(key, cv);
    return cv;
  }
  // --- async macro pipeline: IDB-persisted + rAF-pumped ------------------
  // Macro tiles are pure seeded terrain, so once rendered they're persisted
  // in the same map-image store (key prefix "mac:") and hydrated back as
  // bitmaps — after the first session a fully zoomed-out map is detailed
  // IMMEDIATELY from disk. First-ever tiles render through a paced pump (a
  // couple of ~40ms renders per frame) instead of stalling a draw call.
  function persistMacro(key, cv) {
    { const r = _macroKeyRect(key); if (_isletZoneHit(r[0], r[1], r[2], r[3]) || _isleSealHit(r[0], r[1], r[2], r[3])) return; } // islet + sealed isle — never cache to disk
    try { cv.toBlob(b => { if (b) _mOpen().then(db =>
      db.transaction('m', 'readwrite').objectStore('m').put(b, _mKey('mac:' + key))).catch(() => {}); }, 'image/png'); }
    catch (e) { /* best effort */ }
  }
  // Shared BATCHED hydration pump: one IDB transaction serves up to 32 image
  // reads per frame — a per-get transaction cost ~100ms each and made a
  // zoomed-out viewport take ~10s to hydrate instead of a couple of frames.
  const _hydQ = [];               // { k: full store key, cb(blob|null) }
  let _hydRaf = false;
  function _hydSchedule() { if (!_hydRaf) { _hydRaf = true; requestAnimationFrame(_hydTick); } }
  function _hydTick() {
    _hydRaf = false;
    const batch = _hydQ.splice(0, 32);
    if (batch.length)
      _mOpen().then(db => {
        const st = db.transaction('m', 'readonly').objectStore('m');
        for (const it of batch) {
          const r = st.get(it.k);
          r.onsuccess = e => { try { it.cb(e.target.result || null); } catch (err) { console.warn("hyd cb:", err); } };
          r.onerror = () => { try { it.cb(null); } catch (err) { console.warn("hyd cb:", err); } };
        }
      }).catch(err => { console.warn("hyd batch:", err); for (const it of batch) { try { it.cb(null); } catch (e2) { /* logged above */ } } });
    if (_hydQ.length) _hydSchedule();
  }
  const _macQ = [], _macRenderQ = [], _macInFlight = new Set();
  let _macRaf = false;
  // dedicated worker for macro renders (same roadworker.js file — its full
  // features instance computes macroPixels off-thread at ~25 tiles/s, so
  // first-time zoom-outs sharpen in a couple of seconds with zero main-thread
  // jank; results are cached AND persisted like main-thread renders)
  let _macWorker = null;
  function _macWorkerEnsure() {
    if (_macWorker !== null) return _macWorker;
    if (typeof Worker === "undefined") return (_macWorker = false);
    try {
      _macWorker = new Worker("js/world/roadworker.js");
      _macWorker.postMessage({ type: "init", seed: S, landE: LAND_E, rockE: ROCK_E,
        chunk: CHUNK, vcell: VCELL, pcell: PCELL, icell: ICELL,
        gensig: (typeof WORLDGEN_SIG !== 'undefined' ? WORLDGEN_SIG : 'dev') });
      _macWorker.onmessage = e => {
        const d = e.data;
        if (!d || !d.macro) return;
        const key = d.macro.step + ':' + d.macro.mx + ',' + d.macro.my;
        if (!macroCache.has(key)) {
          const cv = document.createElement('canvas');
          cv.width = cv.height = MACRO_PX;
          cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.px), MACRO_PX, MACRO_PX), 0, 0);
          _macroCacheSet(key, cv);
          persistMacro(key, cv);
        }
        _macInFlight.delete(key);
      };
      _macWorker.onerror = () => { try { _macWorker.terminate(); } catch (e2) { /* dead */ } _macWorker = false; };
    } catch (e) { _macWorker = false; }
    return _macWorker;
  }
  function requestMacro(step, mx, my) {
    const key = step + ':' + mx + ',' + my;
    const c = macroCache.get(key);
    if (c) return c;
    if (!_macInFlight.has(key) && !_macQ.includes(key) && !_macRenderQ.includes(key)) {
      _macQ.push(key);
      _macSchedule();
    }
    return null;
  }
  function _macSchedule() { if (!_macRaf) { _macRaf = true; requestAnimationFrame(_macTick); } }
  // One-shot BULK hydration of every persisted macro tile: a single ranged
  // getAll + parallel bitmap decode loads the whole set in ~100-300ms —
  // per-key IDB gets took seconds for a viewport's worth (Firefox get
  // latency), which read as the map "not loading". Macro bitmaps are 64px
  // (~16KB), so even a big world's full set is small.
  let _macBulkDone = false, _macBulkBusy = false;
  function _macBulkLoad() {
    if (_macBulkBusy || _macBulkDone) return;
    _macBulkBusy = true;
    _mOpen().then(db => new Promise(res => {
      const st = db.transaction('m', 'readonly').objectStore('m');
      const rng = IDBKeyRange.bound(_mKey('mac:'), _mKey('mac:') + '￿');
      const gk = st.getAllKeys(rng), gv = st.getAll(rng);
      let keys = null, vals = null;
      gk.onsuccess = e => { keys = e.target.result; if (vals) res([keys, vals]); };
      gv.onsuccess = e => { vals = e.target.result; if (keys) res([keys, vals]); };
      gk.onerror = gv.onerror = () => res([[], []]);
    })).then(async ([keys, vals]) => {
      const pre = _mKey('mac:').length;
      await Promise.all(keys.map(async (k, i) => {
        const key = String(k).slice(pre);
        if (macroCache.has(key)) return;
        try { _macroCacheSet(key, await createImageBitmap(vals[i])); } catch (e) { /* re-render */ }
      }));
    }).catch(() => { /* fall back to renders */ })
      .then(() => { _macBulkDone = true; _macBulkBusy = false; _macSchedule(); });
  }
  function _macTick() {
    _macRaf = false;
    if (!_macBulkDone) {                 // wait for the bulk load, then drain
      _macBulkLoad();
      if (_macQ.length || _macRenderQ.length) _macSchedule();
      return;
    }
    // post-bulk: anything still missing was never rendered — off to the worker
    while (_macQ.length) {
      const key = _macQ.shift();
      if (!macroCache.has(key) && !_macRenderQ.includes(key) && !_macInFlight.has(key))
        _macRenderQ.push(key);
    }
    // renders: ship the whole batch to the worker (off-thread, no jank);
    // if workers are unavailable, fall back to 2 paced main-thread bakes
    if (_macRenderQ.length && _macWorkerEnsure()) {
      const tiles = [];
      while (_macRenderQ.length) {
        const key = _macRenderQ.shift();
        if (macroCache.has(key)) continue;
        // isletZone tiles stay ON the main thread (the worker's terrain copy
        // only knows the islet's DEFAULT seat, not the chosen body's), and so
        // do seal-touching tiles: the isle-or-masked variant is picked by the
        // VIEWER's side (_viewShowIsle), which the worker can't know
        { const r = _macroKeyRect(key);
          if (_isletZoneHit(r[0], r[1], r[2], r[3]) || _isleSealHit(r[0], r[1], r[2], r[3])) {
            const ci2 = key.indexOf(':');
            getMacro(parseFloat(key.slice(0, ci2)), ...key.slice(ci2 + 1).split(',').map(Number));
            continue;
          } }
        _macInFlight.add(key);                     // blocks re-queue until the worker replies
        const ci = key.indexOf(':');
        const [mxS, myS] = key.slice(ci + 1).split(',');
        tiles.push({ step: parseFloat(key.slice(0, ci)), mx: parseInt(mxS, 10), my: parseInt(myS, 10) });
      }
      if (tiles.length) _macWorker.postMessage({ type: "macro", tiles, MACRO_PX, MAP_COLORS, MAP_WATER });
    } else for (let n = 0; n < 2 && _macRenderQ.length; n++) {
      const key = _macRenderQ.shift();
      if (macroCache.has(key)) continue;
      const [stepS, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const [mxS, myS] = rest.split(',');
      getMacro(parseFloat(stepS), parseInt(mxS, 10), parseInt(myS, 10));   // renders + caches + persists
    }
    if (_macQ.length || _macRenderQ.length) _macSchedule();
  }
  // Prewarm the deep-zoom macro set covering everything the player has
  // explored (steps 16 and 8 — what the fully zoomed-out pyramid draws
  // from), so the wide view is already sharp when they zoom out. Bounded:
  // a huge save's bbox at these steps is a few hundred small tiles.
  function prewarmMacros() {
    _macBulkLoad();                      // whole persisted set in one ranged getAll
    if (typeof seenChunks === "undefined" || !seenChunks.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of seenChunks) {
      const c = k.indexOf(',');
      const cx = +k.slice(0, c), cy = +k.slice(c + 1);
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    }
    let queued = 0;
    for (const step of [16, 8, 4]) {
      const MT = MACRO_PX * step;              // map units per macro tile
      const m0x = Math.floor(x0 * 16 / MT), m1x = Math.floor(x1 * 16 / MT);
      const m0y = Math.floor(y0 * 16 / MT), m1y = Math.floor(y1 * 16 / MT);
      for (let my = m0y; my <= m1y && queued < 800; my++)
        for (let mx = m0x; mx <= m1x && queued < 800; mx++)
          if (!macroCache.has(step + ':' + mx + ',' + my)) { requestMacro(step, mx, my); queued++; }
    }
  }

  const mapChunkCache = new Map();
  // Bounded insertion-order cache. A long-lived save can have MANY thousands
  // of seen chunks; holding a 256px image (or worse, a raw canvas) for every
  // one of them has OOM-crashed the tab at load. Evicted images stay persisted
  // in IndexedDB and are re-hydrated on demand by the prewarm pump.
  const MAP_CACHE_CAP = 700;
  function _mapCacheSet(key, img) {
    if (!mapChunkCache.has(key) && mapChunkCache.size >= MAP_CACHE_CAP) {
      const oldest = mapChunkCache.keys().next().value;
      const ev = mapChunkCache.get(oldest);
      mapChunkCache.delete(oldest);
      if (ev && typeof ev.close === "function") { try { ev.close(); } catch (e) { /* already closed */ } }
    }
    mapChunkCache.set(key, img);
  }

  // --- persisted map-image cache (IndexedDB) + background prewarm ---
  // Rendered chunk images are saved locally and preloaded at boot, so the
  // world map shows every explored area instantly. Chunks explored this
  // session are rendered in idle time (prewarm queue) rather than while the
  // map is open.
  // Bumped to v3: the road network changed twice (river-avoidance added, then
  // reverted) and bridges became bank-to-bank stone decks — cached v2 images
  // still show the old roads/crossings and no longer match the world.
  // AUTO-VERSIONED (2026-09-16, supersedes the hand-bumped -vNN scheme): the
  // store name carries MAPBAKE_SIG — a build-time hash of every world-gen
  // source PLUS this painter (tools/build.mjs MAP_FILES) — so any change to
  // Tūhura Isle, world generation, or the map rendering itself re-keys the
  // persisted bakes (chunk images, mip tiles, macro tiles) on the next
  // build. The map and minimap can never show stale terrain; no manual
  // bump, ever. Stale generations are swept below by enumeration.
  const _MAPDB = 'ioe-mapimg-' + (typeof MAPBAKE_SIG !== 'undefined' ? MAPBAKE_SIG : 'dev');
  function _sweepStaleIDB(prefix, keep) {   // (same helper as chunks.js — files are standalone)
    try {
      if (indexedDB.databases)
        indexedDB.databases().then(dbs => {
          for (const d of dbs || [])
            if (d && d.name && d.name.startsWith(prefix) && d.name !== keep)
              try { indexedDB.deleteDatabase(d.name); } catch (e) { /* best effort */ }
        }).catch(() => { /* enumeration unsupported */ });
    } catch (e) { /* best effort */ }
  }
  _sweepStaleIDB('ioe-mapimg-', _MAPDB);
  let _mdb = null;
  function _mOpen() {
    if (_mdb) return Promise.resolve(_mdb);
    return new Promise((res, rej) => {
      const r = indexedDB.open(_MAPDB, 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore('m');
      r.onsuccess = e => { _mdb = e.target.result; res(_mdb); };
      r.onerror = e => rej(e.target.error);
    });
  }
  const _mKey = key => `${S}/${key}`;
  // --- the Swim-Master's isletZone (terrain.js): PER-CHARACTER geometry ---
  // The motu re-seats when a body is chosen (Tutorial.isletSync), so no map
  // artefact that shows it may be persisted: chunk bakes, mip tiles and
  // macro tiles overlapping the zone render fresh each session (and macro
  // renders for the zone stay ON the main thread — the road worker's
  // terrain copy only knows the DEFAULT seat). mapDropRect below is the
  // in-memory invalidation isletSync calls when the seat moves.
  function _isletZoneHit(x0, y0, x1, y1) {  // MAP-coord rect vs the zone
    if (typeof TUT_ISLE === "undefined" || !TUT_ISLE.isletZone) return false;
    const Z = TUT_ISLE.isletZone;
    return x0 < Z.x1 && x1 > Z.x0 && y0 < Z.y1 && y1 > Z.y0;
  }
  // --- the isle's SEALED disc (terrain.js TUT_ISLE.SEAL_D): a SEPARATE map -
  // No artefact that touches the seal is ever persisted (same scheme as the
  // islet zone above): the isle renders fresh for the character living its
  // tutorial, and graduation's world.mapDropRect purge (tutorial.js
  // graduateCore) is then the WHOLE cleanup — a graduated save can never
  // re-hydrate isle art from disk into the wide world's map, and a mip tile
  // assembled while on the isle can never survive into a mainland session.
  function _isleSealHit(x0, y0, x1, y1) {  // MAP-coord rect vs the seal disc
    if (typeof TUT_ISLE === "undefined" || !TUT_ISLE.SEAL_D) return false;
    const R = TUT_ISLE.RO + TUT_ISLE.SEAL_D;
    const nx = Math.max(x0, Math.min(TUT_ISLE.CX, x1));
    const ny = Math.max(y0, Math.min(TUT_ISLE.CY, y1));
    return Math.hypot(nx - TUT_ISLE.CX, ny - TUT_ISLE.CY) < R;
  }
  const _chunkKeyRect = key => {          // "gcx,gcy" chunk bake → map rect
    const [cx, cy] = key.split(",").map(Number);
    return [cx * 16, cy * 16, cx * 16 + 16, cy * 16 + 16];
  };
  const _mipKeyRect = key => {            // "L:tx,ty" mip tile → map rect
    const [L, rest] = key.split(":");
    const [tx, ty] = rest.split(",").map(Number);
    const span = (1 << +L) * 16;
    return [tx * span, ty * span, (tx + 1) * span, (ty + 1) * span];
  };
  const _macroKeyRect = key => {          // "step:mx,my" macro tile → map rect
    const [st, rest] = key.split(":");
    const [mx, my] = rest.split(",").map(Number);
    const MT = MACRO_PX * +st;
    return [mx * MT, my * MT, (mx + 1) * MT, (my + 1) * MT];
  };
  // Drop every in-memory map artefact intersecting the MAP-coord rect —
  // chunk bakes (the minimap composites these too), mip tiles, macro tiles
  // and the flat-cell memo. Persisted copies need no cleanup: the guards on
  // persistMapImage/_mipPersist/persistMacro keep zone artefacts out of IDB.
  function mapDropRect(x0, y0, x1, y1) {
    const sweep = (cache, rectOf, close) => {
      for (const k of [...cache.keys()]) {
        const r = rectOf(k);
        if (r[0] < x1 && r[2] > x0 && r[1] < y1 && r[3] > y0) {
          const v = cache.get(k);
          cache.delete(k);
          if (close && v && typeof v.close === "function") { try { v.close(); } catch (e) { /* already closed */ } }
        }
      }
    };
    sweep(mapChunkCache, _chunkKeyRect, true);
    sweep(mipCache, _mipKeyRect, false);
    sweep(macroCache, _macroKeyRect, false);
    _flatCache.clear();
  }
  function persistMapImage(key, canvas) {
    { const r = _chunkKeyRect(key); if (_isletZoneHit(r[0], r[1], r[2], r[3]) || _isleSealHit(r[0], r[1], r[2], r[3])) return; }
    try {
      canvas.toBlob(b => {
        if (!b) return;
        _mOpen().then(db => db.transaction('m', 'readwrite').objectStore('m').put(b, _mKey(key))).catch(() => {});
      }, 'image/png');
    } catch (e) { /* persistence is best-effort */ }
  }
  async function preloadMapImages(keys) {
    let db;
    try { db = await _mOpen(); } catch { return; }
    await Promise.all([...keys].filter(k => !mapChunkCache.has(k)).map(key => new Promise(res => {
      const r = db.transaction('m', 'readonly').objectStore('m').get(_mKey(key));
      r.onsuccess = async e => {
        const blob = e.target.result;
        if (blob) {
          try { _mapCacheSet(key, await createImageBitmap(blob)); } catch (err) { /* re-render later */ }
        }
        res();
      };
      r.onerror = res;
    })));
  }
  // requestAnimationFrame-budgeted, matching Map.html's frame() pump instead
  // of requestIdleCallback (which the browser can defer arbitrarily, and the
  // old code awaited one item's full async chain — IDB round-trip included —
  // before even scheduling the next idle callback, compounding the delay).
  // Kicks off a small, fixed number of NEW hydrate/render attempts per frame
  // (they run concurrently once started, not serialized), so a big cheat-mode
  // reveal or a long save's worth of newly-seen chunks streams in smoothly
  // instead of trickling in one every ~120ms+.
  const _prewarmQ = [];
  const _prewarmRenderQ = [];
  const _prewarmInFlight = new Set();
  let _rafScheduled = false;
  const PREWARM_PER_FRAME = 12;   // hydrations only — they ride the shared batched IDB pump
  function _scheduleFrame() {
    if (_rafScheduled) return;
    _rafScheduled = true;
    requestAnimationFrame(_prewarmTick);
  }
  function _prewarmTick() {
    _rafScheduled = false;
    let started = 0;
    while (started < PREWARM_PER_FRAME && _prewarmQ.length) {
      const key = _prewarmQ.shift();
      if (mapChunkCache.has(key) || _prewarmInFlight.has(key)) continue;
      _prewarmInFlight.add(key);
      started++;
      // hydrate from the persisted image first — re-rendering may force full
      // chunk generation, which is far too heavy to do for a whole save's
      // worth of chunks (and was part of the load-time OOM crash)
      _hydQ.push({ k: _mKey(key), cb: async blob => {
        if (blob) {
          try { _mapCacheSet(key, await createImageBitmap(blob)); _prewarmInFlight.delete(key); return; }
          catch (err) { /* fall through to a fresh render */ }
        }
        _prewarmRenderQ.push(key);   // miss: full render, paced below
        _scheduleFrame();
      } });
    }
    if (started) _hydSchedule();
    // full renders are heavy (may force chunk gen) — pace them
    for (let n = 0; n < 2 && _prewarmRenderQ.length; n++) {
      const key = _prewarmRenderQ.shift();
      _prewarmInFlight.delete(key);
      if (mapChunkCache.has(key)) continue;
      try { const [cx, cy] = key.split(',').map(Number); renderMapChunk(cx, cy); } catch (e) { /* skip bad chunk */ }
    }
    if (_prewarmQ.length || _prewarmRenderQ.length) _scheduleFrame();
  }
  function prewarmMapChunk(gcx, gcy) {
    const key = `${gcx},${gcy}`;
    if (mapChunkCache.has(key) || _prewarmInFlight.has(key) || _prewarmQ.includes(key)) return;
    _prewarmQ.push(key);
    _scheduleFrame();
  }
  // Non-blocking lookup for the map view: returns the cached image or null
  // (after queueing a background render) so panning/zooming never stalls.
  function renderMapChunkCached(gcx, gcy) {
    const key = `${gcx},${gcy}`;
    const img = mapChunkCache.get(key);
    if (img) return img;
    prewarmMapChunk(gcx, gcy);
    return null;
  }

  // --- mip pyramid: the zoomed-in tile art, kept visible when zoomed out ---
  // Level L covers 2^L × 2^L game chunks in ONE 256px canvas: level 0 is the
  // real baked chunk image (the same "presaved pictures" persisted in
  // IndexedDB above), and every higher level composites its four children at
  // half size — clusters of matching tiles scaled down, generalizing further
  // with each level. A quadrant whose bake isn't cached yet is filled from
  // the cheap macro art and REFINED in place once the background bake/IDB
  // hydration arrives (throttled re-composite), so zooming out never lags:
  // the map draws instantly from whatever is ready and sharpens as it loads.
  const MIP_MAX = 6;             // top level: 64×64 chunks (2048 tiles) per canvas
  const MIP_CACHE_CAP = 130;     // ≥1 levels only — L0 IS the existing bake, never copied
  const mipCache = new Map();    // "L:tx,ty" → { cv, done, at }
  function _mipCacheSet(key, rec) {
    if (!mipCache.has(key) && mipCache.size >= MIP_CACHE_CAP)
      mipCache.delete(mipCache.keys().next().value);
    mipCache.set(key, rec);
  }
  // paint macro art over a map-coord rect (the placeholder for regions whose
  // real bake hasn't streamed in yet — also usable straight from the map
  // draw). COARSE on purpose: one shared macro tile spans several chunks
  // (step ≥ 0.5 → an MT=32+ macro covers 2×2+ chunks), so a big viewport of
  // placeholders touches a few dozen cached macros, not one fine bake per
  // chunk — a per-chunk step-0.25 version thrashed the macro LRU and cost
  // seconds per draw. Clipped: a shared macro overhangs the target rect.
  function mipMacroFill(c2, dx, dy, dpx, mapX0, mapY0, span) {
    const step = Math.max(0.5, span / 64);
    const MT = MACRO_PX * step;
    const scale = dpx / span;
    let full = true;                 // false = some cells were flat stand-ins
    c2.save();
    c2.beginPath(); c2.rect(dx, dy, dpx, dpx); c2.clip();
    for (let my = Math.floor(mapY0 / MT); my * MT < mapY0 + span; my++)
      for (let mx = Math.floor(mapX0 / MT); mx * MT < mapX0 + span; mx++) {
        const rx = dx + (mx * MT - mapX0) * scale, ry = dy + (my * MT - mapY0) * scale, rs = MT * scale;
        let img = macroCache.get(step + ':' + mx + ',' + my);
        if (!img && _macroBudget > 0) { _macroBudget--; img = getMacro(step, mx, my); }
        if (img) { c2.drawImage(img, rx, ry, rs, rs); continue; }
        requestMacro(step, mx, my);      // hydrate from disk / paced render
        full = false;
        // out of budget this pass: one biome-accurate flat cell (single
        // classify sample, memoised) — a textured macro replaces it later
        const fkey = step + ':' + mx + ',' + my;
        let fill = _flatCache.get(fkey);
        if (!fill) {
          const wx = (mx + 0.5) * MT, wy = (my + 0.5) * MT;
          // sealed isle disc reads as deep sea, same viewer-side mask as
          // macroPixels (mapDropRect clears _flatCache on the side flip)
          const e = (!_viewShowIsle() && typeof inTutSeal === "function" && inTutSeal(wx * 2, wy * 2)) ? 0.335 : elevation(wx, wy);
          const col = e < LAND_E
            ? (e < 0.34 ? MAP_WATER[0] : e < 0.41 ? MAP_WATER[1] : e < 0.45 ? MAP_WATER[2] : MAP_WATER[3])
            : MAP_COLORS[classify(e, humidity(wx, wy), temperature(wx, wy), farmField(wx, wy), civField(wx, wy), weirdField(wx, wy))];
          fill = `rgb(${col[0]},${col[1]},${col[2]})`;
          if (_flatCache.size > 4000) _flatCache.clear();
          _flatCache.set(fkey, fill);
        }
        c2.fillStyle = fill;
        c2.fillRect(rx, ry, rs, rs);
      }
    c2.restore();
    return full;
  }
  // Budgets for one draw pass: new child mip canvases + new macro bakes —
  // deep pyramid levels materialize a couple of children and a bounded batch
  // of macro tiles per frame instead of the whole 4^L fan-out at once; the
  // 900ms map refresh timer sharpens the rest progressively. Granted by
  // wmDraw before its tile loop.
  let _mipBudget = 0, _macroBudget = 0;
  const _flatCache = new Map();    // (step,mx,my) → css colour for flat stand-in cells
  function mipBudget(kids, macros) { _mipBudget = kids; _macroBudget = macros == null ? 10 : macros; }
  // Finished mip tiles are THEMSELVES persisted ("mip:L:tx,ty" in the same
  // image store): a whole converged zoom level is a few dozen small bitmaps,
  // so any later session shows real tile art at full zoom-out immediately —
  // no need to re-hydrate thousands of individual chunk bakes first.
  function _mipPersist(key, cv) {
    { const r = _mipKeyRect(key); if (_isletZoneHit(r[0], r[1], r[2], r[3]) || _isleSealHit(r[0], r[1], r[2], r[3])) return; } // islet + sealed isle — never cache to disk
    try { cv.toBlob(b => { if (b) _mOpen().then(db =>
      db.transaction('m', 'readwrite').objectStore('m').put(b, _mKey('mip2:' + key))).catch(() => {}); }, 'image/png'); }
    catch (e) { /* best effort */ }
  }
  const _mipHydrating = new Set();
  function _mipHydrate(key) {
    if (_mipHydrating.has(key)) return;
    _mipHydrating.add(key);
    _hydQ.push({ k: _mKey('mip2:' + key), cb: async blob => {
      try {
        if (blob) {
          const bm = await createImageBitmap(blob);
          const cur = mipCache.get(key);
          if (!cur || !cur.done)
            _mipCacheSet(key, { cv: bm, done: true, at: Date.now(), fromDisk: true,
              seenN: typeof seenChunks !== "undefined" ? seenChunks.size : 0 });
        }
      } catch (e) { /* re-composite instead */ }
      _mipHydrating.delete(key);
    } });
    _hydSchedule();
  }
  // read-only peek (kicks a disk hydration on miss) — the map draw uses it
  // to find a FINISHED ancestor tile to scale down smoothly while a finer
  // level is still assembling, so nothing on screen is ever blocky.
  function mipPeek(L, tx, ty) {
    const key = L + ":" + tx + "," + ty;
    const rec = mipCache.get(key);
    if (!rec) _mipHydrate(key);
    return rec || null;
  }
  // tx,ty are level-L grid indices (one unit = 2^L game chunks), L >= 1.
  // Always returns a canvas immediately; incomplete tiles re-composite at
  // most every 350ms (cheap: 4 cached drawImages) as bakes stream in, and
  // freeze once every explored chunk under them shows its real art. Only
  // SEEN chunks are ever baked — unexplored ground stays macro (there is no
  // persisted image for it, and force-rendering would run full chunk gen).
  function mipTile(L, tx, ty) {
    const key = L + ":" + tx + "," + ty;
    let rec = mipCache.get(key);
    const t = Date.now();
    if (!rec) _mipHydrate(key);           // a persisted copy may land shortly
    // a "done" tile stays frozen only while nothing new has been explored —
    // fresh exploration (seenChunks grows) invalidates the freeze so newly
    // seen chunks get their real art on the next recomposite
    const seenN = typeof seenChunks !== "undefined" ? seenChunks.size : 0;
    if (rec && ((rec.done && rec.seenN === seenN) || t - rec.at < 350)) return rec.cv;
    // a disk-hydrated rec is an ImageBitmap — start a fresh canvas to rebuild
    const reuse = rec && !rec.fromDisk;
    const cv = reuse ? rec.cv : document.createElement("canvas");
    if (!reuse) { cv.width = cv.height = 256; }
    const c2 = cv.getContext("2d");
    c2.imageSmoothingEnabled = true;
    // mips are PURE tile art with TRANSPARENT holes: a quadrant without its
    // real bake stays clear (the map's zoom-matched macro underlay shows
    // through) instead of being painted with coarse macro — so a mip never
    // bakes blocky placeholder pixels into itself or into its persisted copy.
    c2.clearRect(0, 0, 256, 256);
    let done = true;
    for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
      const kx = tx * 2 + qx, ky = ty * 2 + qy, dx = qx * 128, dy = qy * 128;
      if (L === 1) {
        const seen = typeof seenChunks !== "undefined" && seenChunks.has(kx + "," + ky);
        const img = seen ? renderMapChunkCached(kx, ky) : null;  // queues the bake if missing
        if (img) c2.drawImage(img, dx, dy, 128, 128);
        else if (seen) done = false;      // transparent until the bake streams in
        // unseen chunks: transparent AND final (nothing will ever bake there)
      } else {
        const kid = mipCache.get((L - 1) + ":" + kx + "," + ky);
        if (kid || _mipBudget > 0) {
          if (!kid) _mipBudget--;
          c2.drawImage(mipTile(L - 1, kx, ky), dx, dy, 128, 128);
          const k2 = mipCache.get((L - 1) + ":" + kx + "," + ky);
          if (!k2 || !k2.done) done = false;
        } else done = false;              // transparent hole until budget allows
      }
    }
    const becameDone = done && !(rec && rec.done);
    _mipCacheSet(key, { cv, done, at: t, seenN });
    if (becameDone) _mipPersist(key, cv);
    return cv;
  }
  // memoised single-classify flat colour for a macro cell — the last-resort
  // stand-in for the very first frames before any macro art exists
  function macroFlat(step, mx, my) {
    const fkey = step + ':' + mx + ',' + my;
    let fill = _flatCache.get(fkey);
    if (!fill) {
      const MT = MACRO_PX * step;
      const wx = (mx + 0.5) * MT, wy = (my + 0.5) * MT;
      // the isle's sealed disc reads as deep sea, same viewer-side mask as
      // macroPixels (mapDropRect clears _flatCache on the side flip)
      const e = (!_viewShowIsle() && typeof inTutSeal === "function" && inTutSeal(wx * 2, wy * 2)) ? 0.335 : elevation(wx, wy);
      const col = e < LAND_E
        ? (e < 0.34 ? MAP_WATER[0] : e < 0.41 ? MAP_WATER[1] : e < 0.45 ? MAP_WATER[2] : MAP_WATER[3])
        : MAP_COLORS[classify(e, humidity(wx, wy), temperature(wx, wy), farmField(wx, wy), civField(wx, wy), weirdField(wx, wy))];
      fill = `rgb(${col[0]},${col[1]},${col[2]})`;
      if (_flatCache.size > 4000) _flatCache.clear();
      _flatCache.set(fkey, fill);
    }
    return fill;
  }

  // riversNear's own search radius (RIV_RANGE, ~1264 map-coord units) is far
  // wider than a single 16-tile chunk, so a viewport of many adjacent chunks
  // has each one independently re-run an almost-identical ~180-cell river
  // search (plus roads/villages/POIs) — nearly all of it a cache hit after
  // the first chunk, but the per-call Set/bbox overhead alone dominated a
  // fresh multi-chunk viewport draw (profiled: ~99% of a fresh chunk's cost
  // was this querying, not the terrain/classify loop below). Querying ONCE
  // for the whole viewport and handing every chunk the same shared lists
  // turns "N chunks x ~180-cell scan" into "1 scan", independent of N.
  function mapRegionQuery(bx0, by0, bx1, by1) {
    return {
      rivs: riversNear(bx0 - 12, by0 - 12, bx1 + 12, by1 + 12),
      roads: roadsNear(bx0 - 8, by0 - 8, bx1 + 8, by1 + 8),
      villages: villagesNearForMap(bx0, by0, bx1, by1, 42),
      pois: poisNearForMap(bx0, by0, bx1, by1, 26),
    };
  }
  // shared: optional { rivs, roads, villages, pois } from mapRegionQuery,
  // covering a region that contains this chunk — see note above. Callers
  // rendering a single/few chunks (prewarm, minimap) can omit it and fall
  // back to a per-chunk query.
  function renderMapChunk(gcx, gcy, shared) {
    const key = `${gcx},${gcy}`;
    if (mapChunkCache.has(key)) return mapChunkCache.get(key);

    const TILE = 16;      // pixels per Map.html tile (higher res → clearer tiles at zoom 20)
    const CS = 16;        // Map.html tiles per game chunk (CHUNK/2)
    const canvas = document.createElement('canvas');
    canvas.width = CS * TILE; canvas.height = CS * TILE;
    const ctx = canvas.getContext('2d');
    const baseX = gcx * CS, baseY = gcy * CS; // Map.html tile origin

    // Sample field grids with margin
    const M = 5, GS = CS + 2 * M + 1;
    const eG=new Float32Array(GS*GS), mG=new Float32Array(GS*GS), tG=new Float32Array(GS*GS);
    const fG=new Float32Array(GS*GS), cG=new Float32Array(GS*GS), wG=new Float32Array(GS*GS);
    for(let gy=0; gy<GS; gy++) {
      const wy=baseY+gy-M;
      for(let gx=0; gx<GS; gx++) {
        const wx=baseX+gx-M, i=gy*GS+gx;
        // map-coord grids — used for water/river/coastline detection (rivers/POIs are in map coords)
        // genChunk samples at hx=wx*0.5 (map coords), so map renderer does the same
        eG[i]=elevation(wx,wy); mG[i]=humidity(wx,wy); tG[i]=temperature(wx,wy);
        fG[i]=farmField(wx,wy); cG[i]=civField(wx,wy); wG[i]=weirdField(wx,wy);
      }
    }
    const G=(tx,ty)=>(ty+M)*GS+(tx+M);

    // rasterize river and road polylines into chunk masks (rvM: 1=river, rdM: 1=road)
    const rvM=new Uint8Array(GS*GS), rdM=new Uint8Array(GS*GS);
    const gx0=baseX-M, gy0=baseY-M;
    const stamp=(mask,wx,wy,r,val,soft)=>{
      const lx=wx-gx0, ly=wy-gy0;
      const xa=Math.max(0,Math.ceil(lx-r)), xb=Math.min(GS-1,Math.floor(lx+r));
      const ya=Math.max(0,Math.ceil(ly-r)), yb=Math.min(GS-1,Math.floor(ly+r));
      for(let yy=ya;yy<=yb;yy++) for(let xx=xa;xx<=xb;xx++){
        const ddx=xx-lx,ddy=yy-ly;
        if(ddx*ddx+ddy*ddy>r*r) continue;
        const ii=yy*GS+xx;
        if(!soft||mask[ii]===0) mask[ii]=val;
      }
    };
    const walkPoly=(pts,cb)=>{
      for(let i=1;i<pts.length;i++){
        const ax=pts[i-1][0],ay=pts[i-1][1],aw=pts[i-1][2]||0;
        const bx2=pts[i][0],by2=pts[i][1],bw=pts[i][2]||0;
        const pad=Math.max(aw,bw)+3;
        if(Math.max(ax,bx2)<gx0-pad||Math.min(ax,bx2)>gx0+GS+pad||
           Math.max(ay,by2)<gy0-pad||Math.min(ay,by2)>gy0+GS+pad) continue;
        const nn=Math.max(1,Math.ceil(Math.hypot(bx2-ax,by2-ay)/0.75));
        for(let ss=0;ss<=nn;ss++){const t=ss/nn;cb(ax+(bx2-ax)*t,ay+(by2-ay)*t,aw+(bw-aw)*t);}
      }
    };
    const q = shared || mapRegionQuery(baseX, baseY, baseX+CS, baseY+CS);
    const mapRivs=q.rivs;
    const rvWideM=new Uint8Array(GS*GS); // river + bank band: road here = bridge decking
    for(const rv of mapRivs) for(const pts of rv.polys)
      walkPoly(pts,(px,py,pw)=>stamp(rvM,px,py,pw+1.8,2,true));
    for(const rv of mapRivs) for(const pts of rv.polys)
      walkPoly(pts,(px,py,pw)=>stamp(rvM,px,py,pw,1,false));
    for(const rv of mapRivs) for(const pts of rv.polys)
      walkPoly(pts,(px,py,pw)=>stamp(rvWideM,px,py,pw+3,1,false));
    for(const rp of q.roads)
      walkPoly(rp.pts,(px,py)=>stamp(rdM,px,py,ROAD_W,1,false));
    const riverAt=i=>rvM[i]===1;
    const roadAt=i=>rdM[i]===1;
    const waterAt=i=>eG[i]<LAND_E||rvM[i]===1;

    const villages=q.villages;
    const nearVillage=(wx,wy)=>villages.some(v=>{ const dx=wx-v.x,dy=wy-v.y; return dx*dx+dy*dy<v.r*v.r; });
    const pois=q.pois;
    const nearPoi=(wx,wy)=>pois.some(p=>{ const dx=wx-p.x,dy=wy-p.y,r=({shack:4,farmstead:11,windmill:6,manor:11,guild:8,ruins:6,watchtower:4,fishvillage:10,orchard:9,graveyard:7,campsite:4,fairyring:4,standing:3,obelisk:3,wizardtower:5,minecamp:6,lighthouse:5,pond:6,lumbercamp:6,shrine:4,inn:6,watermill:7,maze:9,greatlab:15,battlefield:7,arena:6,totem:3,apiary:5,crater:6,hotspring:5,statue:4,portal:4,garden:7,tarpit:6,stonecircle:6,barrow:5,shipwreck:6,geyser:4,beacon:3,hermitage:4,vineyard:8,gallows:3,observatory:6,wishingwell:3}[p.type]||5); return dx*dx+dy*dy<r*r; });

    // --- terrain ---
    // Each map tile (wx,wy) in map-coord space covers 2×2 game tiles.
    // Render each game tile as a HT×HT pixel block so biome boundaries match the 3D world.
    const HT = TILE >> 1; // 8px per game tile
    const bImg = typeof IMGS !== 'undefined' && IMGS['b'];
    for(let ty=0; ty<CS; ty++) {
      for(let tx=0; tx<CS; tx++) {
        const wx=baseX+tx, wy=baseY+ty, i=G(tx,ty);
        const e=eG[i], river=riverAt(i), road=rdM[i]===1;
        const sea=e<LAND_E;
        const coastline=(sea||river)&&(!waterAt(G(tx+1,ty))||!waterAt(G(tx-1,ty))||!waterAt(G(tx,ty+1))||!waterAt(G(tx,ty-1)));
        // decking spans bank to bank: any road inside the river band is
        // bridge; a road out on the sea is an overpass bridge deck
        const bridge=road&&(river||sea||rvWideM[i]===1);
        // classify()-dependent fields, sampled once per map-tile (block of 2x2
        // game subtiles) and shared below — see note in the land branch.
        let mtb;
        if(!sea&&!river) {
          const gm=humidity(wx,wy), gt=temperature(wx,wy);
          const gf=farmField(wx,wy), gc=civField(wx,wy), gw=weirdField(wx,wy);
          mtb=classify(e,gm,gt,gf,gc,gw);
          if(mtb===B.FARM&&nearVillage(wx,wy)) mtb=B.GRASS;
        }
        // 2×2 sub-tiles — each is one game tile
        for(let sy=0;sy<2;sy++) for(let sx=0;sx<2;sx++) {
          const gwx=wx*2+sx, gwy=wy*2+sy;
          const cpx=tx*TILE+sx*HT, cpy=ty*TILE+sy*HT;
          let r, g, bl;
          if(sea||river) {
            if(bridge) { r=MAP_BRIDGE[0]; g=MAP_BRIDGE[1]; bl=MAP_BRIDGE[2]; }
            else if(coastline) { r=32; g=46; bl=68; }
            else {
              const s=river?MAP_WATER[2]:e<0.34?MAP_WATER[0]:e<0.41?MAP_WATER[1]:e<0.45?MAP_WATER[2]:MAP_WATER[3];
              r=s[0]; g=s[1]; bl=s[2];
              if(!river&&tG[i]>0.68&&e>0.44&&wG[i]>0.62) {
                const cr=rand2(gwx,gwy,S^0xcafe);
                if(cr<0.09){r=226;g=120;bl=140;}else if(cr<0.15){r=238;g=168;bl=92;}else if(cr<0.21){r=92;g=190;bl=178;}
              }
              const j=(rand2(gwx,gwy,S^0xa5a5)-0.5)*6; r+=j; g+=j; bl+=j;
            }
            ctx.fillStyle=`rgb(${r|0},${g|0},${bl|0})`;
            ctx.fillRect(cpx,cpy,HT,HT);
          } else {
            // Sample noise at half-game coords (gwx*0.5) matching genChunk's hx=wx*0.5
            const hgx=gwx*0.5, hgy=gwy*0.5;
            const ge=elevation(hgx,hgy);
            // classify()'s other 5 inputs (humidity/temperature/farmField/civField/
            // weirdField) are each their own fbm-weighted noise call — by far the
            // most expensive part of this loop, and the reason a fresh chunk bake
            // cost 40-170ms even after the water/river/road setup was already done.
            // Biome boundaries essentially never fall inside a single map-coord
            // tile, so sampling them (and classify() itself) once per map-tile —
            // i.e. once per 2x2 game-tile block, reusing `mtb` across this map
            // tile's 4 subtiles below — instead of once per game subtile cuts that
            // 4x with no visible loss. Elevation stays fully per-subtile: it drives
            // hillshade, which does need to look sharp up close.
            let b=mtb;
            let col=MAP_COLORS[b];
            // approach decking reads as bridge (river band, or the shore of a
            // sea crossing — a road tile right beside sea-level water)
            if(road) col=(rvWideM[i]===1||eG[G(tx+1,ty)]<LAND_E||eG[G(tx-1,ty)]<LAND_E||
                          eG[G(tx,ty+1)]<LAND_E||eG[G(tx,ty-1)]<LAND_E)?MAP_BRIDGE:MAP_PATH;
            else if(b===B.LABYRINTH) {
              // carved maze walls (labgen.js) — mirrors genChunk exactly
              if(labMaze.hedgeWallAt(hgx,hgy)) col=[40,80,38];
            }
            r=col[0]; g=col[1]; bl=col[2];
            let sh=Math.max(-26,Math.min(26,(ge-elevation(hgx+0.5,hgy+0.5))*260));
            if(b===B.CANYON) sh+=Math.sin(ge*320)*9;
            else if(b===B.BADLANDS) sh+=Math.sin(ge*320)*5;
            r+=sh; g+=sh; bl+=sh;
            const j=(rand2(gwx,gwy,S^0xa5a5)-0.5)*13; r+=j; g+=j; bl+=j;
            const labWall=b===B.LABYRINTH&&labMaze.hedgeWallAt(hgx,hgy);
            if(bImg&&bImg.complete&&bImg.naturalWidth>0&&!road&&!labWall) {
              const pers=personalityAt(gwx,gwy);
              ctx.drawImage(bImg,pers*33,b*33,32,32,cpx,cpy,HT,HT);
            } else {
              ctx.fillStyle=`rgb(${r|0},${g|0},${bl|0})`;
              ctx.fillRect(cpx,cpy,HT,HT);
            }
          }
        }
      }
    }

    // --- Tūhura Isle overlay: paths, fences, gates, bridge, pier (user req) ---
    // The bake is ANALYTIC — it never reads painted chunk tiles — so the
    // isle's built lines are recomputed from the same terrain.js geometry
    // the chunk painter uses. Drawn per GAME tile (TILE/2 px sub-cells), so
    // single-file fences stay single-file on the map and minimap alike.
    if (typeof tutIsleSD === "function" && typeof tutFenceAt === "function" &&
        typeof TUT_ISLE !== "undefined" &&
        baseX + CS >= TUT_ISLE.bbox.x0 && baseX <= TUT_ISLE.bbox.x1 &&
        baseY + CS >= TUT_ISLE.bbox.y0 && baseY <= TUT_ISLE.bbox.y1) {
      const HT2 = TILE / 2, RIV = TUT_ISLE.river;
      for (let ty = 0; ty < CS; ty++) for (let tx = 0; tx < CS; tx++) {
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
          const mx = baseX + tx + sx * 0.5, my = baseY + ty + sy * 0.5; // game-tile centre, map coords
          const q2 = tutIsleSD(mx, my);
          if (!q2) continue;
          const px2 = tx * TILE + sx * HT2, py2 = ty * TILE + sy * HT2;
          // bridge deck: ONLY the Cove→Forge crossing (s past 1.9) — between
          // the Bush chamber and the Cove the journey RIDES the water through
          // the river gate, so no deck is painted there (mirrors chunks.js)
          if (q2.d < 1.1 && q2.s > 1.9 && q2.pRiver >= 0 && q2.riverLine < RIV.waterR + 2) {
            ctx.fillStyle = "#9aa2ad"; ctx.fillRect(px2, py2, HT2, HT2); // bridge deck
            continue;
          }
          const f = tutFenceAt(mx, my);
          if (f) {
            ctx.fillStyle = f.gate >= 0 ? "#e7c860" : "#5d4429";
            ctx.fillRect(px2, py2, HT2, HT2);                            // gate arch / fence post
            continue;
          }
          if (q2.D < -1.5 && q2.d < 0.9) {
            ctx.fillStyle = "#b9905b"; ctx.fillRect(px2, py2, HT2, HT2); // the walking path
          }
        }
      }
      // the Harbour pier: radial decking from pod 14 out to sea (stamped as
      // decor in chunks — recomputed here the same way tutorial.js stamps it)
      {
        const p14 = TUT_ISLE.pods[14], a = p14.ang * Math.PI / 180;
        ctx.fillStyle = "#9aa2ad";
        for (let k = 12; k <= 30; k += 0.5) {
          const gx2 = p14.mx * 2 + Math.round(Math.cos(a) * k);
          const gy2 = p14.my * 2 + Math.round(Math.sin(a) * k);
          const lx = gx2 / 2 - baseX, ly = gy2 / 2 - baseY;
          if (lx >= 0 && lx < CS && ly >= 0 && ly < CS)
            ctx.fillRect(Math.floor(lx * TILE), Math.floor(ly * TILE), HT2, HT2);
        }
      }
    }

    // --- decorations ---
    // Draw in TILE=4 coordinate space then scale up so hardcoded pixel sizes stay proportional
    ctx.save();
    ctx.scale(TILE / 4, TILE / 4);
    for(let ty=-4; ty<CS+4; ty++) {
      for(let tx=-4; tx<CS+4; tx++) {
        const wx=baseX+tx, wy=baseY+ty, i=G(tx,ty);
        if(waterAt(i)||roadAt(i)||nearVillage(wx,wy)||nearPoi(wx,wy)) continue;
        const roll=rand2(wx,wy,S^0x51ab);
        const b=classify(eG[i],mG[i],tG[i],fG[i],cG[i],wG[i]);
        const px=tx*4+2+(rand2(wx,wy,S^0x77e1)-0.5)*3;
        const py=ty*4+2+(rand2(wx,wy,S^0x77e2)-0.5)*3;
        switch(b) {
          // Trees — items32.png row 2: 0-2=oak, 3=slim, 4=pine, 5=palm, 6=cherry, 7=purple, 8=orange, 9=yellow, 10=acacia, 11=birch, 13=teal tropical, 14=fantasy, 15=dark
          // row 3: 0-2=dense oaks, 3=dead grey tree
          case B.FOREST: { const dens=Math.min(0.75,0.28+(mG[i]-0.53)*2.2); if(roll<dens) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e0)%3,2,5); break; }
          case B.JUNGLE: if(roll<0.55) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e1)%2===0?13:5,2,5); break;
          case B.TAIGA: if(roll<0.30) mSpr(ctx,px,py,4,2,5); break;
          case B.GRASS: if(roll<0.035) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e2)%2,2,4); else if(roll>0.993) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e3)%5,13,3); break;
          case B.FARM: if(roll>0.995) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e4)%5,13,3); break;
          case B.MEADOW: if(roll<0.015) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e5)%2===0?6:7,2,5); else if(roll>0.94) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e6)%5,13,3); break;
          case B.SAVANNA: if(roll<0.03) mSpr(ctx,px,py,10,2,5); else if(roll<0.06) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e7)%3,6,3); break;
          case B.TUNDRA: if(roll<0.06) mSpr(ctx,px,py,4,2,4); break;
          case B.SNOW:
            if(eG[i]>ROCK_E) { if(roll<0.05) mSpr(ctx,px,py,12,4,4); else if(roll<0.19) mSpr(ctx,px,py,1,4,3); }
            else if(roll<0.025) mSpr(ctx,px,py,4,2,4); break;
          case B.SWAMP: if(roll<0.10) mDrawPuddle(ctx,px,py); else if(roll<0.17) mSpr(ctx,px,py,3,3,4); else if(roll<0.23) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e8)%3,2,4); break;
          case B.WETLAND: if(roll<0.16) mDrawPuddle(ctx,px,py); else if(roll<0.26) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7e9)%3,7,3); break;
          // Ores/rocks — row 4: 0=grey rock, 1=blue-grey, 2=dark, 3=dark purple, 4=blue crystal, 5=gold ore, 6=orange ore, 11=red, 12=pale/white, 13=teal
          case B.DESERT: if(roll<0.015) mSpr(ctx,px,py,5,5,4); break;
          case B.REDDESERT: if(roll<0.008) mSpr(ctx,px,py,5,5,4); else if(roll<0.045) mSpr(ctx,px,py,11,4,4); break;
          case B.OASIS:
            if(roll<0.10) mSpr(ctx,px,py,5,2,5);
            else if(roll<0.17) { ctx.fillStyle=`rgb(${MAP_WATER[3].join(',')})`; ctx.beginPath(); ctx.ellipse(px,py,3,2,0,0,Math.PI*2); ctx.fill(); } break;
          case B.STEPPE: if(roll<0.03) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7ea)%3+9,6,3); break;
          case B.BADLANDS: if(roll<0.08) mSpr(ctx,px,py,2,4,4); else if(roll<0.09) mSpr(ctx,px,py,10,6,3); break;
          case B.CANYON: if(roll<0.12) mSpr(ctx,px,py,6,4,4); break;
          case B.ROCKY: if(roll<0.07) mSpr(ctx,px,py,0,4,4); else if(roll<0.15) mSpr(ctx,px,py,1,4,3); else if(roll<0.17) mSpr(ctx,px,py,8,6,3); break;
          case B.ROCK: if(roll<0.05) mSpr(ctx,px,py,0,4,4); else if(roll<0.19) mSpr(ctx,px,py,2,4,3); break;
          case B.VOLCANO:
            if(roll<0.05) { ctx.fillStyle='#e87820'; ctx.beginPath(); ctx.arc(px,py,1.3,0,Math.PI*2); ctx.fill(); }
            else if(roll<0.12) mSpr(ctx,px,py,3,4,4); break;
          case B.WILD: if(roll<0.08) mSpr(ctx,px,py,3,3,4); else if(roll<0.10) mSpr(ctx,px,py,0,7,3); break;
          case B.RUINSB: if(roll<0.05) mSpr(ctx,px,py,0,4,4); else if(roll<0.09) mSpr(ctx,px,py,3,3,3); break;
          case B.BONE:
            // Forageable — row 6-7: 0=dark berries, 1=purple, 2=green, 3-4=mushrooms, 6=purple shroom, 8=blueberry, 13=starfish
            if(roll<0.05) mSpr(ctx,px,py,hash2i(wx,wy,S^0xb0e)%3,7,3);
            else if(roll<0.07) { ctx.fillStyle='#ece8d8'; ctx.beginPath(); ctx.arc(px,py,1.5,0,Math.PI*2); ctx.fill(); } break;
          case B.SALT: if(roll<0.04) mSpr(ctx,px,py,12,4,4); break;
          case B.MUSHROOM: if(roll<0.10) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7eb)%4,7,4); break;
          case B.DREAM:
            if(roll<0.18) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7ec)%2===0?14:7,2,5);
            else if(roll>0.985) { ctx.fillStyle='#e8f0ff'; ctx.fillRect(px-1,py-1,2,2); } break;
          case B.ASH:
            if(roll<0.10) mSpr(ctx,px,py,3,3,4);
            else if(roll<0.16) { ctx.fillStyle='#b8b4b0'; ctx.fillRect(px-1,py-1,2,2); } break;
          case B.MOOR:
            if(roll<0.14) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7ed)%2===0?10:11,6,3);
            else if(roll<0.17) mSpr(ctx,px,py,1,4,3); else if(roll<0.185) mSpr(ctx,px,py,0,4,3); break;
          case B.GLACIER:
            if(roll<0.045) mSpr(ctx,px,py,12,4,4);
            else if(roll<0.06) mSpr(ctx,px,py,1,4,3); break;
          case B.BAMBOO: if(roll<0.40) mSpr(ctx,px,py,3,2,5); break;
          case B.CHERRY:
            if(roll<0.30) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7ee)%2===0?6:7,2,5);
            else if(roll>0.97) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7ef)%5,13,3); break;
          case B.CRYSTAL:
            if(roll<0.08) mSpr(ctx,px,py,hash2i(wx,wy,S^0x7f0)%3+4,4,4);
            else if(roll>0.98) { ctx.fillStyle='#e8e0ff'; ctx.fillRect(px-1,py-1,2,2); } break;
        }
      }
    }

    // --- fish (water tiles) — items32.png row 0: col 1-14 = fish, col 15 = crab, row 1 = more
    for(let ty=0; ty<CS; ty++) {
      for(let tx=0; tx<CS; tx++) {
        const wx=baseX+tx, wy=baseY+ty, i=G(tx,ty);
        if(!waterAt(i)) continue;
        if(rand2(wx,wy,S^0x51f1)>0.025) continue;
        const fc=1+hash2i(wx,wy,S^0xf15)%14;
        const fr=hash2i(wx,wy,S^0xf16)%2;
        mSpr(ctx, tx*4+2, ty*4+2, fc, fr, 3);
      }
    }

    ctx.restore(); // end decoration scale

    // --- settlements ---
    const pathCss=`rgb(${MAP_PATH.join(',')})`;
    for(const v of villages) {
      const ox=(v.x-baseX)*TILE, oy=(v.y-baseY)*TILE;
      // (city interiors keep their biome ground on the map too — the world
      // no longer paves them; buildings + paths carry the city read)
      const vRy=v.Ry!=null?v.Ry:v.R;
      if(v.kind==='city') {
        const Rpx=v.R*TILE, RyPx=vRy*TILE;
        ctx.fillStyle=pathCss;
        if(v.layout===1) {
          ctx.strokeStyle=pathCss; ctx.lineWidth=TILE*2;
          ctx.beginPath(); ctx.moveTo(ox-Rpx*0.75,oy-Rpx*0.75); ctx.lineTo(ox+Rpx*0.75,oy+Rpx*0.75);
          ctx.moveTo(ox-Rpx*0.75,oy+Rpx*0.75); ctx.lineTo(ox+Rpx*0.75,oy-Rpx*0.75); ctx.stroke();
        } else if(v.layout===2) {
          const off=Math.floor(v.R*0.55)*TILE;
          for(const dx of [-off,0,off]) ctx.fillRect(ox+dx-TILE,oy-Rpx,TILE*2,Rpx*2);
          ctx.fillRect(ox-Rpx,oy-TILE,Rpx*2,TILE*2);
        } else {
          ctx.fillRect(ox-TILE,oy-RyPx,TILE*2,RyPx*2);
          ctx.fillRect(ox-Rpx,oy-TILE,Rpx*2,TILE*2);
        }
        if(!v.keep) ctx.fillRect(ox-TILE*4,oy-TILE*4,TILE*8,TILE*8);
      } else {
        ctx.strokeStyle=pathCss; ctx.lineWidth=TILE-1;
        if(v.layout===1&&v.buildings.length>1) {
          const a=v.buildings[0], bb=v.buildings[v.buildings.length-1];
          ctx.beginPath();
          ctx.moveTo((a.x+a.w/2-baseX)*TILE,(a.y+a.h/2-baseY)*TILE);
          ctx.lineTo((bb.x+bb.w/2-baseX)*TILE,(bb.y+bb.h/2-baseY)*TILE);
          ctx.stroke();
        } else {
          for(const bd of v.buildings) {
            ctx.beginPath(); ctx.moveTo(ox,oy);
            ctx.lineTo((bd.x+bd.w/2-baseX)*TILE,(bd.y+bd.h/2-baseY)*TILE); ctx.stroke();
          }
          ctx.fillStyle=pathCss; ctx.beginPath(); ctx.arc(ox,oy,TILE*2.4,0,Math.PI*2); ctx.fill();
        }
        if(v.field) mDrawWheat(ctx,(v.field.x-baseX)*TILE,(v.field.y-baseY)*TILE,v.field.w*TILE,v.field.h*TILE);
      }
      for(const bd of v.buildings) {
        // interior CUTAWAY, not a roof slab: the wood-plank floor every house
        // has on the ground storey (same boards as upstairs), framed by the
        // wall run — so shops and homes read as their inside footprint, the
        // way the game shows them when you step through the door. Organic
        // multi-room buildings draw one cutaway per ROOM (bd.rooms), so the
        // map mirrors the stamped footprint, not the bounding box.
        const drawRoom = (rx,ry,rw,rh) => {
          const bx=(rx-baseX)*TILE, by2=(ry-baseY)*TILE;
          const ww = TILE*0.55;                    // wall band thickness
          ctx.fillStyle = bd.stone ? '#8a8a80' : '#5a4632';
          ctx.fillRect(bx,by2,rw*TILE,rh*TILE);
          ctx.fillStyle = '#b0854f';               // floor_wood planks
          ctx.fillRect(bx+ww,by2+ww,rw*TILE-2*ww,rh*TILE-2*ww);
          // faint plank seams so the floor reads as boards, not a flat slab
          ctx.strokeStyle = 'rgba(90,60,30,0.35)'; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let px2 = bx+ww+TILE*0.75; px2 < bx+rw*TILE-ww; px2 += TILE*0.75) {
            ctx.moveTo(px2, by2+ww); ctx.lineTo(px2, by2+rh*TILE-ww);
          }
          ctx.stroke();
          ctx.strokeStyle='#3a352a'; ctx.lineWidth=1.5;
          ctx.strokeRect(bx+0.75,by2+0.75,rw*TILE-1.5,rh*TILE-1.5);
        };
        if(bd.rooms) for(const r of bd.rooms) drawRoom(r.x,r.y,r.w,r.h);
        else drawRoom(bd.x,bd.y,bd.w,bd.h);
        // station marker: crafting stations get a gold diamond, banks a coin,
        // traders a blue dot — hover on the world map names the trade
        if(bd.job) {
          const jr = bd.rooms ? bd.rooms[0] : bd;
          const bx=(jr.x-baseX)*TILE, by2=(jr.y-baseY)*TILE;
          const mx2=bx+jr.w*TILE/2, my2=by2+jr.h*TILE/2, r=Math.max(2.2,TILE*0.9);
          if(bd.job==='bank') {
            ctx.fillStyle='#f2c14e'; ctx.strokeStyle='#5a4310'; ctx.lineWidth=1;
            ctx.beginPath(); ctx.arc(mx2,my2,r*0.85,0,Math.PI*2); ctx.fill(); ctx.stroke();
          } else if(bd.job==='trader') {
            ctx.fillStyle='#5aa2e8'; ctx.strokeStyle='#1c3a5a'; ctx.lineWidth=1;
            ctx.beginPath(); ctx.arc(mx2,my2,r*0.75,0,Math.PI*2); ctx.fill(); ctx.stroke();
          } else {
            ctx.fillStyle='#ffd76a'; ctx.strokeStyle='#4a3208'; ctx.lineWidth=1;
            ctx.beginPath();
            ctx.moveTo(mx2,my2-r); ctx.lineTo(mx2+r,my2); ctx.lineTo(mx2,my2+r); ctx.lineTo(mx2-r,my2);
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        }
      }
      if(v.kind==='city'&&v.wall) {
        const Rpx=v.R*TILE, RyPx=vRy*TILE, gate=TILE*2.5;
        const segs=[];
        for(const s of [-1,1]) {
          segs.push([ox-Rpx,oy+s*RyPx,ox-gate,oy+s*RyPx],[ox+gate,oy+s*RyPx,ox+Rpx,oy+s*RyPx]);
          segs.push([ox+s*Rpx,oy-RyPx,ox+s*Rpx,oy-gate],[ox+s*Rpx,oy+gate,ox+s*Rpx,oy+RyPx]);
        }
        for(const [w,c] of [[TILE*1.5,'#35322a'],[TILE*0.8,'#85816f']]) {
          ctx.strokeStyle=c; ctx.lineWidth=w; ctx.lineCap='butt';
          ctx.beginPath(); for(const [x1,y1,x2,y2] of segs) { ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); } ctx.stroke();
        }
        ctx.fillStyle='#85816f'; ctx.strokeStyle='#35322a'; ctx.lineWidth=1.5;
        for(const sx of [-1,1]) for(const sy of [-1,1]) {
          ctx.fillRect(ox+sx*Rpx-TILE*1.5,oy+sy*RyPx-TILE*1.5,TILE*3,TILE*3);
          ctx.strokeRect(ox+sx*Rpx-TILE*1.5,oy+sy*RyPx-TILE*1.5,TILE*3,TILE*3);
        }
      }
      if(v.well) {
        ctx.fillStyle='#55534b'; ctx.beginPath(); ctx.arc(ox,oy,2.5,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#2c2a24'; ctx.lineWidth=1; ctx.stroke();
      }
    }

    // --- POIs ---
    for(const p of pois) mDrawPoi(ctx, p, baseX, baseY, TILE);

    // The biome-tile atlas ('b') decodes asynchronously; a chunk baked before
    // it's ready falls back to flat fills + hillshade — a smooth colour
    // gradient instead of tiles. NEVER cache or persist such a bake (it used
    // to be frozen into IDB forever for whichever chunks baked first each
    // sig — the recurring "gradient rectangle over Newhaven north"): return
    // it uncached so the next frame re-renders, properly tiled, once the
    // image has decoded.
    if (bImg && !(bImg.complete && bImg.naturalWidth > 0)) return canvas;
    _mapCacheSet(key, canvas);
    persistMapImage(key, canvas);
    return canvas;
  }

  function biomeNameAt(wx, wy) {
    const mx = wx * 0.5, my = wy * 0.5;
    const b = classify(elevation(mx,my), humidity(mx,my), temperature(mx,my), farmField(mx,my), civField(mx,my), weirdField(mx,my));
    return BIOME_NAMES[b] || 'Unknown';
  }

  return { renderMapChunk, renderMapChunkCached, preloadMapImages, prewarmMapChunk, mapDropRect, setMacroIsleView, biomeNameAt, BIOME_NAMES,
    getMacro, overviewStep, OVERVIEW_Z, MACRO_PX, mapChunkCache, macroCache, mapRegionQuery,
    mipTile, mipPeek, mipMacroFill, mipBudget, MIP_MAX, requestMacro, prewarmMacros, macroFlat,
    _macDebug: () => ({ q: _macQ.length, rq: _macRenderQ.length, inf: _macInFlight.size, raf: _macRaf,
      hq: _hydQ.length, hraf: _hydRaf, db: !!_mdb }),
    MAP_PATH, MAP_WATER, MAP_BRIDGE };
}
