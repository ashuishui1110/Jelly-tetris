const canvas = document.getElementById('tetris');
const ctx = canvas.getContext('2d');

// --- 【核心修复】获取设备像素比，进行高清屏适配 ---
const dpr = window.devicePixelRatio || 1;

// 1. 主画布高清化
canvas.width = 240 * dpr;         // 实际渲染像素放大
canvas.height = 400 * dpr;
canvas.style.width = '240px';     // 屏幕显示尺寸保持不变
canvas.style.height = '400px';
ctx.scale(dpr * 20, dpr * 20);    // 坐标系同步放大

// 2. 预览画布高清化
const nextCanvas = document.getElementById('next-piece');
nextCanvas.width = 80 * dpr;
nextCanvas.height = 80 * dpr;
nextCanvas.style.width = '80px';
nextCanvas.style.height = '80px';


// --- 游戏状态 ---
let score = 0, totalLines = 0, hardDrops = 0, rises = 0, startTime = Date.now();
let isGameOver = false, isPaused = false, nextPiece = null;
const arena = createMatrix(12, 20);
const player = { pos: { x: 0, y: 0 }, matrix: null };

// --- 勋章配置 ---
const medalConfig = [
    { id: 'lines', name: '消行达人', desc: '累计消除行数', icon: '🌱', tiers: [10, 50, 200, 500], current: 0 },
    { id: 'score', name: '春意盎然', desc: '单局最高得分', icon: '🌸', tiers: [500, 2000, 5000, 15000], current: 0 },
    { id: 'hard', name: '疾风骤雨', desc: '累计硬降次数', icon: '⚡', tiers: [5, 50, 200, 1000], current: 0 },
    { id: 'rise', name: '攀登者', desc: '抵御地面上升', icon: '🧗', tiers: [3, 15, 50, 150], current: 0 }
];

// --- 视觉配置：轻盈果冻感 ---
const springColors = [
    null, 'rgba(255, 120, 160, 0.6)', 'rgba(255, 180, 100, 0.6)', 'rgba(120, 255, 120, 0.6)', 
    'rgba(100, 200, 255, 0.6)', 'rgba(180, 150, 255, 0.6)', 'rgba(255, 230, 100, 0.6)', 
    'rgba(255, 120, 120, 0.6)', 'rgba(120, 255, 220, 0.6)', 'rgba(255, 150, 255, 0.6)'
];
const borderColors = [
    null, 'rgba(200, 80, 120, 0.7)', 'rgba(200, 130, 60, 0.7)', 'rgba(80, 180, 80, 0.7)', 
    'rgba(60, 150, 200, 0.7)', 'rgba(130, 100, 200, 0.7)', 'rgba(180, 160, 60, 0.7)', 
    'rgba(180, 80, 80, 0.7)', 'rgba(80, 180, 150, 0.7)', 'rgba(180, 100, 180, 0.7)'
];

// --- 特效粒子系统 ---
let particles = [];
class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.size = Math.random() * 0.3 + 0.1;
        this.speedX = Math.random() * 0.5 - 0.25; this.speedY = Math.random() * 0.5 - 0.25;
        this.life = 1;
    }
    update() { this.x += this.speedX; this.y += this.speedY; this.life -= 0.02; }
    draw() { ctx.save(); ctx.globalAlpha = this.life; ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI*2); ctx.fill(); ctx.restore(); }
}

// --- 触控手势逻辑核心 ---
let touchStartX = 0, touchStartY = 0, lastMoveX = 0, lastMoveY = 0;
const MOVE_SENSITIVITY = 25; 

canvas.addEventListener('touchstart', e => {
    if (isGameOver) return;
    if (isPaused) { isPaused = false; document.getElementById('pause-modal').style.display = 'none'; return; }
    touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
    lastMoveX = touchStartX; lastMoveY = touchStartY;
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    if (isGameOver || isPaused) return;
    const curX = e.touches[0].clientX, curY = e.touches[0].clientY;
    const dx = curX - lastMoveX, dy = curY - lastMoveY;

    if (Math.abs(dx) > MOVE_SENSITIVITY) {
        if (dx > 0) { player.pos.x++; if (collide(arena, player)) player.pos.x--; }
        else { player.pos.x--; if (collide(arena, player)) player.pos.x++; }
        lastMoveX = curX; draw();
    }
    if (dy > MOVE_SENSITIVITY) { playerDrop(); lastMoveY = curY; }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', e => {
    if (isGameOver || isPaused) return;
    const endX = e.changedTouches[0].clientX, endY = e.changedTouches[0].clientY;
    const distY = endY - touchStartY, distX = Math.abs(endX - touchStartX);

    if (distX < 10 && Math.abs(distY) < 10) { playerRotate(1); draw(); } 
    else if (distY > 150) hardDrop(); 
    e.preventDefault();
}, { passive: false });

// --- 勋章系统逻辑 ---
function initMedals() {
    const saved = JSON.parse(localStorage.getItem('jelly_medals_v2')) || {};
    const container = document.getElementById('medal-container');
    container.innerHTML = '';
    medalConfig.forEach(m => {
        m.current = saved[m.id] || 0;
        container.innerHTML += `<div class="medal-item" onmousemove="showTooltip(event, '${m.name}', '${m.desc}', ${m.current})" onmouseleave="hideTooltip()"><div class="medal-header"><div class="medal-icon" id="icon-${m.id}">${m.icon}</div><span class="medal-name">${m.name}</span></div><div class="progress-bg"><div class="progress-fill" id="fill-${m.id}"></div></div></div>`;
    });
    updateMedalUI();
}

function updateMedalUI() {
    const saved = JSON.parse(localStorage.getItem('jelly_medals_v2')) || {};
    medalConfig.forEach(m => {
        m.current = saved[m.id] || 0;
        const target = m.tiers.find(t => t > m.current) || m.tiers[m.tiers.length - 1];
        document.getElementById(`fill-${m.id}`).style.width = Math.min(100, (m.current / target) * 100) + '%';
        const tierIdx = m.tiers.findIndex(t => t > m.current);
        const icon = document.getElementById(`icon-${m.id}`);
        if (tierIdx === 1) icon.style.background = '#CD7F32';
        else if (tierIdx === 2) icon.style.background = '#C0C0C0';
        else if (tierIdx === 3 || tierIdx === -1) icon.style.background = '#FFD700';
    });
}

function checkAchievement(id, val) {
    const m = medalConfig.find(x => x.id === id);
    const saved = JSON.parse(localStorage.getItem('jelly_medals_v2')) || {};
    const old = saved[id] || 0;
    saved[id] = (id === 'score') ? Math.max(old, val) : (old + val);
    localStorage.setItem('jelly_medals_v2', JSON.stringify(saved));
    const mil = m.tiers.find(t => old < t && saved[id] >= t);
    if (mil) { spawnParticles(); showToast(m.name + " LV." + (m.tiers.indexOf(mil)+1)); }
    updateMedalUI();
}

// --- 核心渲染引擎 ---
function drawMatrix(matrix, offset, isGhost = false) {
    matrix.forEach((row, y) => row.forEach((value, x) => {
        if (value !== 0) {
            const fx = x + offset.x, fy = y + offset.y;
            ctx.save();
            drawRoundedRectPath(ctx, fx, fy, 1, 1, 0.25);
            if (isGhost) { ctx.globalAlpha = 0.15; ctx.fillStyle = springColors[value]; ctx.fill(); }
            else {
                ctx.globalAlpha = 1.0;
                const grad = ctx.createRadialGradient(fx+0.35, fy+0.35, 0.05, fx+0.5, fy+0.5, 0.8);
                grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)'); 
                grad.addColorStop(0.4, springColors[value]);
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                ctx.fillStyle = grad; ctx.fill();
                ctx.lineWidth = 0.04; ctx.strokeStyle = borderColors[value]; ctx.stroke();
            }
            ctx.restore();
        }
    }));
}

function draw() {
    ctx.fillStyle = '#FAF3E0'; 
    ctx.fillRect(0, 0, 12, 20); // 【优化】精准填充逻辑画板尺寸，而不是物理像素尺寸
    drawMatrix(arena, {x:0, y:0});
    drawMatrix(player.matrix, {x:player.pos.x, y:getGhostY()}, true);
    drawMatrix(player.matrix, player.pos);
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(draw);
}

// --- 游戏机制函数 ---
function arenaSweep() {
    let cleared = 0;
    outer: for (let y = arena.length - 1; y > 0; --y) {
        for (let x = 0; x < arena[y].length; ++x) if (arena[y][x] === 0) continue outer;
        const row = arena[y]; const isCM = row.every(v => v === row[0]);
        arena.splice(y, 1); arena.unshift(new Array(12).fill(0));
        cleared++; ++y; score += (isCM ? 50 : 10); checkAchievement('lines', 1);
    }
    if (cleared > 0) { document.getElementById('score').innerText = score; checkAchievement('score', score); }
}

function riseArena() {
    if (isPaused || isGameOver) return;
    arena.shift();
    const row = new Array(12).fill(0).map(() => Math.random() > 0.4 ? Math.floor(Math.random()*9)+1 : 0);
    row[Math.floor(Math.random()*12)] = 0;
    arena.push(row); rises++; checkAchievement('rise', 1);
    if (collide(arena, player)) showGameOver();
}

function hardDrop() {
    if (isPaused || isGameOver) return;
    player.pos.y = getGhostY(); merge(arena, player); hardDrops++;
    checkAchievement('hard', 1); arenaSweep(); playerReset();
}

// --- 基础工具逻辑 ---
function createMatrix(w, h) { return Array.from({length: h}, () => Array(w).fill(0)); }
function collide(a, p) {
    const [m, o] = [p.matrix, p.pos];
    for(let y=0; y<m.length; ++y) for(let x=0; x<m[y].length; ++x)
        if(m[y][x]!==0 && (a[y+o.y] && a[y+o.y][x+o.x])!==0) return true;
    return false;
}
function merge(a, p) { p.matrix.forEach((row, y) => row.forEach((v, x) => { if(v!==0) a[y+p.pos.y][x+p.pos.x] = v; })); }
function getGhostY() { let gy = player.pos.y; while(!collide(arena, {matrix: player.matrix, pos: {x: player.pos.x, y: gy+1}})) gy++; return gy; }
function drawRoundedRectPath(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r); ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h); ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r); ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath(); }
function createPiece(t) {
    const pieces = { 'I':[[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]], 'L':[[0,2,0],[0,2,0],[0,2,2]], 'J':[[0,3,0],[0,3,0],[3,3,0]], 'O':[[4,4],[4,4]], 'Z':[[5,5,0],[0,5,5]], 'S':[[0,6,6],[6,6,0]], 'T':[[0,7,0],[7,7,7],[0,0,0]] };
    return pieces[t];
}
function playerReset() {
    const ts = 'ILJOTSZ';
    if(!nextPiece) nextPiece = createPiece(ts[Math.random()*ts.length|0]);
    player.matrix = nextPiece; player.pos.y = 0; player.pos.x = 6 - (player.matrix[0].length/2|0);
    nextPiece = createPiece(ts[Math.random()*ts.length|0]); drawNextPiece();
    if(collide(arena, player)) showGameOver();
}

function drawNextPiece() {
    const nc = document.getElementById('next-piece'), nctx = nc.getContext('2d');
    // 【优化】适配高清缩放后的清除与绘制逻辑
    nctx.clearRect(0, 0, nc.width, nc.height); 
    nctx.save(); 
    nctx.scale(dpr * 20, dpr * 20); // 将 DPR 乘入缩放比例
    
    const off = {x:(4-nextPiece[0].length)/2, y:(4-nextPiece.length)/2};
    nextPiece.forEach((row, y) => row.forEach((v, x) => { 
        if(v!==0){ nctx.fillStyle = springColors[v]; nctx.fillRect(x+off.x, y+off.y, 1, 1); } 
    }));
    nctx.restore();
}

function rotate(m, d) {
    for(let y=0; y<m.length; ++y) for(let x=0; x<y; ++x) [m[x][y], m[y][x]] = [m[y][x], m[x][y]];
    if(d>0) m.forEach(r => r.reverse()); else m.reverse();
}
function playerRotate(d) {
    const ox = player.pos.x; let off = 1; rotate(player.matrix, d);
    while(collide(arena, player)) {
        player.pos.x += off; off = -(off + (off>0?1:-1));
        if(off > player.matrix[0].length) { rotate(player.matrix, -d); player.pos.x = ox; return; }
    }
}
function showToast(txt) { const t=document.getElementById('toast'); document.getElementById('toast-name').innerText=txt; t.style.display='block'; setTimeout(()=>t.style.display='none',3000); }
function spawnParticles() { for(let i=0; i<30; i++) particles.push(new Particle(6, 10, 'rgba(255, 150, 180, 0.8)')); }
function showTooltip(e, n, d, c) { const t=document.getElementById('tooltip'); t.style.display='block'; t.style.left=(e.pageX+10)+'px'; t.style.top=(e.pageY+10)+'px'; t.innerHTML=`<b>${n}</b><br>${d}<br>当前: ${c}`; }
function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }
function showGameOver() { isGameOver = true; document.getElementById('final-score').innerText = score; document.getElementById('game-over-modal').style.display = 'flex'; }
function restartGame() { arena.forEach(r => r.fill(0)); score = 0; startTime = Date.now(); document.getElementById('score').innerText = 0; document.getElementById('game-over-modal').style.display = 'none'; isGameOver = false; playerReset(); }

// --- 主循环 ---
setInterval(() => { if(!isGameOver && !isPaused) document.getElementById('time').innerText = Math.floor((Date.now()-startTime)/1000); }, 1000);
setInterval(riseArena, 30000);
setInterval(() => { if(!isGameOver && !isPaused) { player.pos.y++; if(collide(arena, player)){ player.pos.y--; merge(arena, player); arenaSweep(); playerReset(); } draw(); } }, 1000);

// 键盘兼容
document.addEventListener('keydown', e => {
    if(e.key.toLowerCase() === 'p') { isPaused = !isPaused; document.getElementById('pause-modal').style.display = isPaused?'flex':'none'; return; }
    if(isGameOver || isPaused) return;
    if(e.key === ' ') hardDrop();
    else if(e.key === 'ArrowLeft') { player.pos.x--; if(collide(arena, player)) player.pos.x++; }
    else if(e.key === 'ArrowRight') { player.pos.x++; if(collide(arena, player)) player.pos.x--; }
    else if(e.key === 'ArrowDown') { player.pos.y++; if(collide(arena, player)) { player.pos.y--; merge(arena, player); arenaSweep(); playerReset(); } }
    else if(e.key === 'ArrowUp') playerRotate(1);
});

initMedals(); playerReset(); draw();
