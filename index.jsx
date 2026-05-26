import { useState, useCallback, useEffect, useRef } from "react";

/* ══════════════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════════════ */
const COLS = 6, ROWS = 5, CELL = 66;

// 8 symbols + rare scatter → harder to cluster 8+
const SYM = [
  { id:"banana",   e:"🍌", v:.35, w:18, c:"#FFE135" },
  { id:"cherry",   e:"🍒", v:.5,  w:16, c:"#E53935" },
  { id:"lemon",    e:"🍋", v:.65, w:14, c:"#FDD835" },
  { id:"grape",    e:"🍇", v:.9,  w:11, c:"#8E24AA" },
  { id:"watermel", e:"🍉", v:1.4, w: 8, c:"#43A047" },
  { id:"apple",    e:"🍎", v:2.2, w: 5, c:"#C62828" },
  { id:"diamond",  e:"💎", v:5.5, w: 2, c:"#1E88E5" },
  { id:"scatter",  e:"🍭", v: 0,  w: 2, c:"#D81B60" },
]; // total=76 → scatter ≈ 2.6%

const PAY = {
   8:.75,  9:1.1, 10:1.6, 11:2.2, 12:3,  13:4.2, 14:6,  15:9,
  16:12,  17:16, 18:21,  19:27,  20:34, 21:43,  22:54, 23:67,
  24:83, 25:102, 26:125, 27:153, 28:187,29:228, 30:280,
};

/* ── RNG ─────────────────────────────────────────────────── */
function rng() {
  const t = SYM.reduce((s,x)=>s+x.w,0);
  let r = Math.random()*t;
  for (const s of SYM) { r -= s.w; if (r <= 0) return {...s}; }
  return {...SYM[0]};
}
const mkGrid = () => Array.from({length:ROWS}, ()=>Array.from({length:COLS}, rng));

/* ── WIN DETECTION ──────────────────────────────────────── */
function evalWins(g) {
  const cnt = {};
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const s=g[r][c]; if(s&&s.id!=="scatter") cnt[s.id]=(cnt[s.id]||0)+1;
  }
  const ws=new Set(), ww=[];
  for (const [id,n] of Object.entries(cnt)) if (n>=8) {
    const pm=PAY[Math.min(n,30)]??280;
    const sym=SYM.find(s=>s.id===id);
    ww.push({id,n,pm,v:sym.v,c:sym.c});
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++)
      if (g[r][c]?.id===id) ws.add(`${r}-${c}`);
  }
  return {ws,ww};
}

/* ── TUMBLE ─────────────────────────────────────────────── */
function tumble(g, ws) {
  const ng = Array.from({length:ROWS}, ()=>Array(COLS).fill(null));
  for (let c=0;c<COLS;c++) {
    let w=ROWS-1;
    for (let r=ROWS-1;r>=0;r--) if (!ws.has(`${r}-${c}`)) ng[w--][c]=g[r][c];
    while (w>=0) ng[w--][c]=rng();
  }
  return ng;
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* ══════════════════════════════════════════════════════════════
   STRIP REEL COMPONENT — the animated scroll strip per column
══════════════════════════════════════════════════════════════ */
const PRE = 42; // symbols above the final 5 in each strip
const STRIP_H = (PRE + ROWS) * CELL; // total strip height
const TARGET_Y = -(PRE * CELL);      // translateY when stopped

function ReelStrip({ strip, offsetY, blurred, bouncing }) {
  return (
    <div style={{
      width: CELL,
      height: ROWS * CELL,
      overflow: "hidden",
      borderRadius: 10,
      position: "relative",
    }}>
      <div style={{
        transform: `translateY(${offsetY}px)`,
        willChange: "transform",
        // No CSS transition here — JS controls it every frame
      }}>
        {strip.map((sym, i) => (
          <div key={i} style={{
            width: CELL, height: CELL,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 30,
            background: i < PRE
              ? "linear-gradient(180deg,rgba(255,255,255,.04),rgba(0,0,0,.15))"
              : "linear-gradient(180deg,rgba(255,255,255,.07),rgba(0,0,0,.1))",
            borderBottom: "1px solid rgba(255,255,255,.06)",
            filter: blurred ? "blur(3px) brightness(.6)" : "none",
            transition: blurred ? "none" : "filter .15s",
            animation: bouncing ? "cellBounce .42s cubic-bezier(.28,1.8,.55,.9)" : "none",
          }}>
            {sym.e}
          </div>
        ))}
      </div>
      {/* Top shadow gradient — masks the strip edges */}
      <div style={{
        position:"absolute",top:0,left:0,right:0,height:20,
        background:"linear-gradient(180deg,rgba(0,0,0,.7),transparent)",
        pointerEvents:"none", zIndex:2,
      }}/>
      <div style={{
        position:"absolute",bottom:0,left:0,right:0,height:20,
        background:"linear-gradient(0deg,rgba(0,0,0,.7),transparent)",
        pointerEvents:"none", zIndex:2,
      }}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN GAME
══════════════════════════════════════════════════════════════ */
export default function BananaBonanza() {
  const [bal,  setBal]  = useState(1000);
  const [bet,  setBet]  = useState(10);

  // Two display modes: "reel" during spin, "grid" when idle/wins
  const [mode, setMode] = useState("grid"); // "grid" | "reel"

  // Grid mode state
  const [grid,      setGrid]      = useState(mkGrid);
  const [winSet,    setWinSet]    = useState(new Set());
  const [scatSet,   setScatSet]   = useState(new Set());
  const [tumbleSet, setTumbleSet] = useState(new Set());

  // Reel mode state (6 animated strips)
  const [strips,     setStrips]     = useState(null); // strip[col] = [{e,id,...}]
  const [offsets,    setOffsets]    = useState(Array(COLS).fill(0));
  const [blurCols,   setBlurCols]   = useState(Array(COLS).fill(false));
  const [bounceCols, setBounceCols] = useState(Array(COLS).fill(false));

  const [spinning,  setSpinning]  = useState(false);
  const [totalWin,  setTotalWin]  = useState(0);
  const [lastWin,   setLastWin]   = useState(0);
  const [msg,       setMsg]       = useState("");
  const [freeSpins, setFreeSpins] = useState(0);
  const [inFS,      setInFS]      = useState(false);
  const [mult,      setMult]      = useState(1);
  const [showPay,   setShowPay]   = useState(false);

  const rafRef    = useRef(null);
  const animState = useRef(null); // mutable animation state, not React state
  const finalGrid = useRef(null);

  /* ── ANIMATION LOOP ───────────────────────────────────────── */
  function startReelAnim(finalG, onDone) {
    // Build strips: PRE random rows + final 5 rows (per column)
    const builtStrips = Array.from({length:COLS}, (_,c) => [
      ...Array.from({length:PRE}, ()=>rng()),
      ...Array.from({length:ROWS}, (_,r)=>finalG[r][c]),
    ]);
    setStrips(builtStrips);

    const SPEED = 38; // px per frame during fast spin
    const STOP_TIMES = [760, 1070, 1380, 1690, 2000, 2310]; // ms from spin start

    animState.current = {
      cols: Array.from({length:COLS}, (_,i) => ({
        y: 0,
        speed: SPEED,
        stopping: false,
        done: false,
        stopFrom: 0,
        stopDuration: 0,
        stopStartTime: 0,
      })),
      stopTimes: STOP_TIMES,
      spinStart: performance.now(),
      doneCalled: new Array(COLS).fill(false),
    };

    setOffsets(Array(COLS).fill(0));
    setBlurCols(Array(COLS).fill(true));
    setBounceCols(Array(COLS).fill(false));

    function frame() {
      const st = animState.current;
      if (!st) return;
      const now = performance.now();
      const elapsed = now - st.spinStart;

      const newOffsets = [];
      let anyActive = false;

      for (let i = 0; i < COLS; i++) {
        const col = st.cols[i];

        if (col.done) {
          newOffsets.push(TARGET_Y);
          continue;
        }
        anyActive = true;

        // Trigger stop?
        if (!col.stopping && elapsed >= st.stopTimes[i]) {
          col.stopping = true;
          col.stopFrom = col.y;
          const remaining = Math.abs(TARGET_Y - col.y);
          col.stopDuration = Math.max(280, Math.min(800, remaining * 0.38));
          col.stopStartTime = now;
        }

        if (!col.stopping) {
          col.y -= col.speed;
          // Safety: never overshoot target
          if (col.y <= TARGET_Y) {
            col.y = TARGET_Y;
            col.stopping = true;
            col.stopFrom = TARGET_Y;
            col.stopDuration = 1;
            col.stopStartTime = now;
          }
          newOffsets.push(col.y);
        } else {
          // Ease-out to TARGET_Y
          const t = Math.min(1, (now - col.stopStartTime) / col.stopDuration);
          const eased = 1 - Math.pow(1-t, 3); // cubic ease-out
          col.y = col.stopFrom + eased * (TARGET_Y - col.stopFrom);
          newOffsets.push(col.y);

          if (t >= 1) {
            col.y = TARGET_Y;
            col.done = true;
            // Bounce + unblur this column
            if (!st.doneCalled[i]) {
              st.doneCalled[i] = true;
              const capturedI = i;
              setBlurCols(prev => { const n=[...prev]; n[capturedI]=false; return n; });
              setBounceCols(prev => { const n=[...prev]; n[capturedI]=true; return n; });
              setTimeout(() => setBounceCols(prev => {
                const n=[...prev]; n[capturedI]=false; return n;
              }), 500);
            }
          }
        }
      }

      setOffsets([...newOffsets]);

      if (anyActive) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        // All columns stopped
        cancelAnimationFrame(rafRef.current);
        animState.current = null;
        onDone();
      }
    }

    rafRef.current = requestAnimationFrame(frame);
  }

  /* ── MAIN SPIN LOGIC ──────────────────────────────────────── */
  const doSpin = useCallback(async () => {
    if (spinning) return;
    if (!inFS && bal < bet) { setMsg("💸 Not enough balance!"); return; }

    setSpinning(true);
    setWinSet(new Set()); setScatSet(new Set());
    setTotalWin(0); setLastWin(0); setMsg("");

    let curMult = 1;
    if (!inFS) {
      setBal(b => b - bet);
    } else {
      setFreeSpins(f => f - 1);
      if (Math.random() < 0.35) {
        const opts = [2,3,4,5,8,10,15,20,50,100];
        curMult = opts[Math.floor(Math.random()*opts.length)];
        setMult(curMult);
        setMsg(`💣 ${curMult}× MULTIPLIER BOMB!`);
      } else {
        setMult(1);
      }
    }

    const fg = mkGrid();
    finalGrid.current = fg;

    // Switch to reel mode and animate
    setMode("reel");

    await new Promise(resolve => {
      startReelAnim(fg, resolve);
    });

    // All reels stopped — switch back to grid, then evaluate
    const finalG = finalGrid.current;
    setGrid(finalG.map(r=>[...r]));
    setMode("grid");
    setStrips(null);

    await sleep(300);

    // Scatter check
    let sc = 0; const scats = new Set();
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++)
      if (finalG[r][c].id==="scatter") { sc++; scats.add(`${r}-${c}`); }
    setScatSet(scats);

    if (sc >= 4 && !inFS) {
      const bonus = sc===4?10 : sc===5?15 : 20;
      setMsg(`🍭 ${sc} SCATTERS — ${bonus} FREE SPINS!`);
      await sleep(2200);
      setInFS(true); setFreeSpins(bonus);
      setSpinning(false); return;
    }

    // Tumble loop
    let g = finalG.map(r=>[...r]);
    let accum = 0, loops = 0;

    while (loops < 15) {
      const {ws, ww} = evalWins(g);
      if (ww.length === 0) break;

      const amt = ww.reduce((s,w) => s + w.v * w.pm * bet * curMult, 0);
      accum += amt;
      setWinSet(new Set(ws));
      setLastWin(amt);
      setTotalWin(accum);
      setMsg(`💰 WIN  ₱${amt.toFixed(2)}${curMult>1 ? `  ×${curMult}` : ""}`);
      setBal(b => b + amt);

      await sleep(1100);

      // Tumble
      const ng = tumble(g, ws);
      setTumbleSet(new Set(ws)); // cells being replaced will tumble-in
      g = ng;
      setGrid(ng.map(r=>[...r]));
      setWinSet(new Set());
      await sleep(130);
      setTumbleSet(new Set());
      await sleep(420);
      loops++;
    }

    if (accum === 0) setMsg("");
    else setMsg(`🎉  TOTAL WIN  ₱${accum.toFixed(2)}`);
    setSpinning(false);
  }, [spinning, inFS, bal, bet]);

  // Auto-play free spins
  useEffect(() => {
    if (inFS && freeSpins > 0 && !spinning) {
      const t = setTimeout(() => doSpin(), 1400);
      return () => clearTimeout(t);
    }
    if (inFS && freeSpins === 0) {
      setInFS(false); setMult(1);
      setMsg("🎊  FREE SPINS COMPLETE!");
    }
  }, [inFS, freeSpins, spinning]);

  // Cleanup rAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const BETS = [1, 5, 10, 20, 50, 100];

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <div style={{
      minHeight:"100vh",
      background:"radial-gradient(ellipse at 25% 15%, #1B3A0F 0%, #0A1C06 45%, #03080100 100%)",
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:"12px 8px",
      fontFamily:"'Trebuchet MS','Segoe UI',sans-serif",
      userSelect:"none", overflow:"hidden", position:"relative",
    }}>

      {/* ── Ambient foliage ── */}
      {["🍃","🌴","🍃","🌿"].map((l,i)=>(
        <div key={i} style={{
          position:"absolute",
          top: i<2?"10%":"auto", bottom:i>=2?"5%":"auto",
          left: i%2===0?"-2%":"auto", right:i%2!==0?"-2%":"auto",
          fontSize:90+i*15,opacity:.06,
          transform:`rotate(${[-15,25,-10,30][i]}deg)`,
          pointerEvents:"none",
        }}>{l}</div>
      ))}

      {/* ── TITLE ── */}
      <div style={{textAlign:"center", marginBottom:12}}>
        <div style={{
          fontSize:28, fontWeight:900, letterSpacing:3, lineHeight:1,
          background:"linear-gradient(180deg,#FFF59D 0%,#FFD600 30%,#FF8F00 70%,#E65100 100%)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          filter:"drop-shadow(0 3px 14px rgba(255,160,0,.55))",
        }}>🍌  BANANA BONANZA</div>
        <div style={{
          fontSize:10, letterSpacing:5, marginTop:4, fontWeight:700,
          background:"linear-gradient(90deg,#2E7D32,#A5D6A7,#2E7D32)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
        }}>SCATTER SLOTS · CLUSTER PAYS</div>
      </div>

      {/* ── HUD ── */}
      <div style={{display:"flex",gap:8,marginBottom:10,width:"100%",maxWidth:450}}>
        {[
          {l:"BALANCE",  v:`₱${bal.toFixed(0)}`,        a:"#66BB6A"},
          {l:inFS?"FREE SPINS":"BET", v:inFS?`×${freeSpins}`:`₱${bet}`, a:inFS?"#FFD600":"#4FC3F7"},
          {l:"WIN",      v:`₱${totalWin.toFixed(2)}`,   a:"#FFA726"},
        ].map(({l,v,a})=>(
          <div key={l} style={{
            flex:1, textAlign:"center", padding:"6px 8px",
            background:"linear-gradient(180deg,rgba(0,25,0,.8),rgba(0,10,0,.6))",
            border:"1px solid rgba(255,255,255,.09)", borderRadius:10,
            boxShadow:"inset 0 1px 0 rgba(255,255,255,.04)",
          }}>
            <div style={{fontSize:9,color:"#558B2F",letterSpacing:1.5,fontWeight:700}}>{l}</div>
            <div style={{fontSize:17,fontWeight:900,color:a,lineHeight:1.4}}>{v}</div>
          </div>
        ))}
      </div>

      {/* ── Banners ── */}
      {inFS && (
        <div style={{
          background:"linear-gradient(90deg,#880E4F,#AD1457,#880E4F)",
          borderRadius:20, padding:"5px 22px", fontSize:13, fontWeight:900,
          color:"#fff", marginBottom:8, letterSpacing:2,
          boxShadow:"0 0 30px rgba(216,27,96,.7)", animation:"fsPulse 1.1s ease-in-out infinite alternate",
        }}>⚡  FREE SPINS  —  {freeSpins} REMAINING</div>
      )}
      {mult > 1 && (
        <div style={{
          background:"linear-gradient(90deg,#E65100,#FFD600)",
          borderRadius:20, padding:"4px 22px", fontSize:14, fontWeight:900,
          color:"#1a0d00", marginBottom:8, letterSpacing:2,
          boxShadow:"0 0 35px rgba(255,180,0,.8)",
        }}>💣  {mult}×  MULTIPLIER ACTIVE</div>
      )}

      {/* ── Message bar ── */}
      <div style={{
        height:34, display:"flex", alignItems:"center", justifyContent:"center",
        marginBottom:6, fontSize:15, fontWeight:900, letterSpacing:1,
        color: lastWin>0 ? "#FFD600" : "#81C784",
        textShadow: lastWin>0 ? "0 0 28px rgba(255,205,0,.9)" : "none",
        transition:"color .3s",
      }}>
        {msg || (spinning ? "🎰  Spinning..." : "Press SPIN to play!")}
      </div>

      {/* ══ MACHINE FRAME ══ */}
      <div style={{
        background:"linear-gradient(180deg,#1C3A18,#0E2010 60%,#091508)",
        border:"3px solid",
        borderColor:"rgba(200,170,0,.45) rgba(90,70,0,.3) rgba(70,50,0,.4) rgba(180,150,0,.35)",
        borderRadius:22, padding:"10px 10px 8px",
        boxShadow: inFS
          ? "0 0 60px rgba(216,27,96,.3),0 0 120px rgba(216,27,96,.12),inset 0 0 40px rgba(0,0,0,.85)"
          : "0 12px 50px rgba(0,0,0,.95),0 2px 0 rgba(255,255,255,.04) inset,inset 0 0 40px rgba(0,0,0,.7)",
        position:"relative",
      }}>
        {/* top sheen */}
        <div style={{
          position:"absolute",top:0,left:"10%",right:"10%",height:3,
          background:"linear-gradient(90deg,transparent,rgba(255,220,0,.3),transparent)",
          borderRadius:2,
        }}/>

        {/* ── REEL WINDOW container ── */}
        <div style={{
          background:"rgba(0,0,0,.5)",
          borderRadius:14, padding:5,
          border:"1px solid rgba(255,255,255,.07)",
          boxShadow:"inset 0 2px 8px rgba(0,0,0,.9)",
        }}>

          {/* ── REEL MODE (spinning strips) ── */}
          {mode === "reel" && strips && (
            <div style={{display:"flex", gap:5}}>
              {Array.from({length:COLS},(_,c)=>(
                <ReelStrip
                  key={c}
                  strip={strips[c]}
                  offsetY={offsets[c]}
                  blurred={blurCols[c]}
                  bouncing={bounceCols[c]}
                />
              ))}
            </div>
          )}

          {/* ── GRID MODE (idle / wins / tumble) ── */}
          {mode === "grid" && (
            <div style={{
              display:"grid",
              gridTemplateColumns:`repeat(${COLS},${CELL}px)`,
              gap:5,
            }}>
              {grid.map((row,r)=>row.map((cell,c)=>{
                const key=`${r}-${c}`;
                const isWin   = winSet.has(key);
                const isScat  = scatSet.has(key);
                const isTumble= tumbleSet.has(key);
                const symC = SYM.find(s=>s.id===cell?.id)?.c || "#fff";

                return (
                  <div key={key} style={{
                    width:CELL, height:CELL, borderRadius:10,
                    background: isWin
                      ? `radial-gradient(circle,${symC}50 0%,${symC}14 100%)`
                      : isScat
                      ? "radial-gradient(circle,rgba(216,27,96,.35),rgba(216,27,96,.06))"
                      : "linear-gradient(180deg,rgba(255,255,255,.06),rgba(0,0,0,.18))",
                    border: isWin  ? `2px solid ${symC}`
                          : isScat ? "2px solid rgba(216,27,96,.85)"
                          : "1px solid rgba(255,255,255,.08)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:30, position:"relative", overflow:"hidden",
                    boxShadow: isWin
                      ? `0 0 22px ${symC}99, 0 0 44px ${symC}44`
                      : isScat ? "0 0 18px rgba(216,27,96,.7)" : "none",
                    transition:"border .2s, box-shadow .2s, background .2s",
                    animation: isWin    ? "winPulse .55s ease-in-out infinite alternate"
                             : isTumble ? "tumbleIn .38s ease-out"
                             : "none",
                  }}>
                    {/* Win glow overlay */}
                    {isWin && (
                      <div style={{
                        position:"absolute",inset:0,borderRadius:10,
                        background:`radial-gradient(circle,${symC}45,transparent 65%)`,
                        animation:"glowShift .5s ease-in-out infinite alternate",
                      }}/>
                    )}
                    <span style={{
                      position:"relative", zIndex:1, lineHeight:1,
                      filter: isWin
                        ? `drop-shadow(0 0 7px ${symC}) drop-shadow(0 0 3px #fff)`
                        : "none",
                    }}>
                      {cell?.e || "🍌"}
                    </span>
                  </div>
                );
              }))}
            </div>
          )}

        </div>

        {/* bottom accent line */}
        <div style={{
          height:3,marginTop:8,
          background:"linear-gradient(90deg,transparent,rgba(255,180,0,.3),transparent)",
          borderRadius:2,
        }}/>
      </div>

      {/* ── BET SELECTOR ── */}
      {!inFS && (
        <div style={{display:"flex",gap:5,marginTop:10,flexWrap:"wrap",justifyContent:"center"}}>
          {BETS.map(b=>(
            <button key={b} onClick={()=>!spinning&&setBet(b)} style={{
              padding:"5px 14px", borderRadius:8,
              border: bet===b ? "2px solid #FFD600" : "1px solid rgba(255,255,255,.13)",
              background: bet===b
                ? "linear-gradient(135deg,#FFD600,#FF8C00)"
                : "rgba(255,255,255,.05)",
              color: bet===b ? "#1a0d00" : "#aaa",
              fontWeight:800, fontSize:12,
              cursor: spinning ? "not-allowed" : "pointer",
              transition:"all .15s",
              boxShadow: bet===b ? "0 2px 14px rgba(255,180,0,.4)" : "none",
            }}>₱{b}</button>
          ))}
        </div>
      )}

      {/* ── SPIN BUTTON ── */}
      <button
        onClick={!inFS ? doSpin : undefined}
        disabled={spinning || inFS}
        style={{
          marginTop:10, padding:"15px 58px", borderRadius:50, border:"none",
          background: spinning
            ? "rgba(40,40,40,.5)"
            : inFS
            ? "linear-gradient(135deg,#880E4F,#D81B60)"
            : "linear-gradient(180deg,#FFF59D 0%,#FFD600 25%,#FF8F00 65%,#E65100 100%)",
          color: spinning ? "#444" : inFS ? "#fff" : "#2a1200",
          fontWeight:900, fontSize:18, letterSpacing:3,
          cursor: spinning||inFS ? "not-allowed" : "pointer",
          boxShadow: spinning ? "none"
            : inFS ? "0 6px 32px rgba(216,27,96,.5)"
            : "0 6px 38px rgba(255,140,0,.5), 0 1px 0 rgba(255,255,255,.4) inset, 0 -2px 0 rgba(0,0,0,.35) inset",
          transform: spinning ? "scale(.96)" : "scale(1)",
          transition:"all .15s", minWidth:185,
          textShadow: spinning||inFS ? "none" : "0 1px 2px rgba(0,0,0,.4)",
        }}
      >
        {spinning ? "⏳  SPINNING..." : inFS ? "⚡  AUTO SPIN" : "🍌  SPIN"}
      </button>

      {/* ── PAYTABLE TOGGLE ── */}
      <button onClick={()=>setShowPay(!showPay)} style={{
        marginTop:10, background:"none",
        border:"1px solid rgba(255,255,255,.12)", borderRadius:8,
        color:"#558B2F", fontSize:11, padding:"4px 16px",
        cursor:"pointer", letterSpacing:1,
      }}>{showPay ? "▲ HIDE" : "▼ PAYTABLE"}</button>

      {showPay && (
        <div style={{
          marginTop:8, background:"rgba(0,0,0,.75)",
          border:"1px solid rgba(255,180,0,.18)", borderRadius:14,
          padding:"12px 16px", width:"100%", maxWidth:440,
          backdropFilter:"blur(10px)",
        }}>
          <div style={{
            color:"#FFD600", fontSize:11, fontWeight:800,
            marginBottom:8, letterSpacing:2,
          }}>PAYTABLE  ·  BET ₱{bet}  ·  8+ SAME ANYWHERE</div>

          {SYM.filter(s=>s.id!=="scatter").map(s=>(
            <div key={s.id} style={{
              display:"flex", alignItems:"center", gap:6, padding:"3px 0",
            }}>
              <span style={{fontSize:20,width:26}}>{s.e}</span>
              <div style={{flex:1,display:"flex",gap:3}}>
                {[8,10,12,15,20].map(n=>(
                  <div key={n} style={{
                    fontSize:9, background:"rgba(255,255,255,.07)",
                    borderRadius:4, padding:"2px 5px",
                    color:"#FFD600", fontFamily:"monospace",
                  }}>{n}→₱{(s.v*(PAY[n]||1)*bet).toFixed(0)}</div>
                ))}
              </div>
            </div>
          ))}

          <div style={{
            marginTop:9, paddingTop:9,
            borderTop:"1px solid rgba(255,255,255,.07)",
            color:"#F48FB1", fontSize:11, lineHeight:2,
          }}>
            🍭 <b>4 scatters</b> = 10 free spins · <b>5</b> = 15 · <b>6+</b> = 20<br/>
            💣 Free spins: random <b>multiplier bombs</b> up to <b>100×</b><br/>
            🔄 Winning symbols <b>tumble</b> — chain wins keep adding up!
          </div>
        </div>
      )}

      {/* ── GLOBAL CSS ── */}
      <style>{`
        @keyframes cellBounce {
          0%   { transform: scaleY(1.3) translateY(-12px); opacity:.65; }
          55%  { transform: scaleY(.88) translateY(5px);   opacity:1;   }
          78%  { transform: scaleY(1.07) translateY(-2px);             }
          90%  { transform: scaleY(.98) translateY(1px);               }
          100% { transform: scaleY(1)   translateY(0);                 }
        }
        @keyframes tumbleIn {
          from { transform: translateY(-22px) scale(.82); opacity:0; }
          to   { transform: translateY(0)     scale(1);   opacity:1; }
        }
        @keyframes winPulse {
          from { filter: brightness(1); }
          to   { filter: brightness(1.65) drop-shadow(0 0 10px rgba(255,215,0,.85)); }
        }
        @keyframes glowShift {
          from { opacity:.2; transform: scale(.88); }
          to   { opacity:.85; transform: scale(1.12); }
        }
        @keyframes fsPulse {
          from { box-shadow: 0 0 22px rgba(216,27,96,.5); }
          to   { box-shadow: 0 0 48px rgba(216,27,96,.95), 0 0 80px rgba(216,27,96,.3); }
        }
      `}</style>
    </div>
  );
}
