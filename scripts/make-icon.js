// 生成应用图标 icon/icon.png (256x256): 蓝色渐变圆角方块 + "dsh"
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256, height: 256, show: false, frame: false,
    webPreferences: { offscreen: true },
  })
  const html = `<!doctype html><html><body style="margin:0">
    <canvas id="c" width="256" height="256"></canvas>
    <script>
      const c = document.getElementById('c'), x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#5B7BFF');
      g.addColorStop(1, '#3D55D8');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(52, 0); x.lineTo(204, 0); x.arcTo(256, 0, 256, 52, 52);
      x.lineTo(256, 204); x.arcTo(256, 256, 204, 256, 52);
      x.lineTo(52, 256); x.arcTo(0, 256, 0, 204, 52);
      x.lineTo(0, 52); x.arcTo(0, 0, 52, 0, 52);
      x.closePath(); x.fill();
      x.fillStyle = '#FFFFFF';
      x.font = '700 104px "Segoe UI", sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('dsh', 128, 133);
      const done = document.createElement('div');
      done.id = 'done'; document.body.appendChild(done);
    </script></body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  // 等 canvas 渲染
  await new Promise((r) => setTimeout(r, 900))
  const img = await win.webContents.capturePage()
  const outDir = path.join(__dirname, '..', 'icon')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'icon.png'), img.toPNG())
  console.log('icon written:', path.join(outDir, 'icon.png'))
  app.exit(0)
})
