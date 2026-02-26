export function createSnakeRenderer({
  canvas,
  ctx,
  ui,
  gridW,
  gridH,
  cell,
  tickMsStart,
  colors
}) {
  function updateUI(snapshot) {
    if (ui.score) ui.score.textContent = String(snapshot.score);
    if (ui.best) ui.best.textContent = String(snapshot.bestScore);
    if (ui.speed) {
      const speedRatio = (tickMsStart / snapshot.tickMs).toFixed(2);
      ui.speed.textContent = `${speedRatio}x`;
    }
  }

  function drawGrid() {
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colors.grid;
    for (let y = 0; y < gridH; y += 1) {
      for (let x = 0; x < gridW; x += 1) {
        ctx.fillRect(x * cell, y * cell, 1, 1);
      }
    }
  }

  function drawSnake(snapshot) {
    ctx.fillStyle = colors.body;
    for (let i = snapshot.snake.length - 1; i >= 1; i -= 1) {
      const s = snapshot.snake[i];
      ctx.fillRect(s.x * cell, s.y * cell, cell, cell);
    }

    ctx.fillStyle = colors.head;
    const h = snapshot.snake[0];
    ctx.fillRect(h.x * cell, h.y * cell, cell, cell);
  }

  function drawApple(snapshot) {
    ctx.fillStyle = colors.apple;
    ctx.beginPath();
    const cx = snapshot.apple.x * cell + cell / 2;
    const cy = snapshot.apple.y * cell + cell / 2;
    ctx.arc(cx, cy, cell * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawOverlay(text, sub) {
    ctx.fillStyle = colors.fade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    if (sub) ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 20);
  }

  function draw(snapshot) {
    updateUI(snapshot);
    drawGrid();
    drawSnake(snapshot);
    drawApple(snapshot);

    if (snapshot.state === 'start') {
      drawOverlay('Tap, Swipe, or Press WASD to Start', 'P = Pause, R = Restart');
      return;
    }
    if (snapshot.state === 'pause') {
      drawOverlay('Paused', 'Tap Pause / press P to resume');
      return;
    }
    if (snapshot.state === 'over') {
      drawOverlay('Game Over', 'Tap Restart / press R');
    }
  }

  return {
    draw,
    drawGrid,
    drawSnake,
    drawApple,
    drawOverlay
  };
}
