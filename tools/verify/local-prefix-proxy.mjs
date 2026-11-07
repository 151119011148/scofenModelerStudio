// 与线上 Nginx 等价的最小反代：把 /scofen/modelerStudio/* 剥前缀转发到本地 jar（含 WS 升级）。
//
// 用途：前端按子路径（SCOFEN_BASE=/scofen/modelerStudio/）构建后，本地 jar 直接开在根路径，
// index.html 引用的 /scofen/modelerStudio/assets/* 会 404，E2E 脚本连登录页都进不去。
// 起这个反代就能在本地复刻线上路径：
//   node local-prefix-proxy.mjs            # 18092 -> 127.0.0.1:18091
//   APP_URL='http://127.0.0.1:18092/scofen/modelerStudio/' CDP_PORT=9444 node shell-ux-e2e.mjs
import http from 'node:http'
import net from 'node:net'

const LISTEN = Number(process.env.LISTEN ?? 18092)
const TARGET_HOST = '127.0.0.1'
const TARGET_PORT = Number(process.env.TARGET_PORT ?? 18091)
const PREFIX = '/scofen/modelerStudio'

const server = http.createServer((req, res) => {
  if (!req.url.startsWith(PREFIX)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found: ' + req.url)
    return
  }
  const path = req.url.slice(PREFIX.length) || '/'
  const upstream = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path, headers: { ...req.headers, host: TARGET_HOST + ':' + TARGET_PORT } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    }
  )
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('upstream error: ' + err.message)
  })
  req.pipe(upstream)
})

server.on('upgrade', (req, socket, head) => {
  const path = req.url.startsWith(PREFIX) ? req.url.slice(PREFIX.length) : req.url
  const up = net.connect(TARGET_PORT, TARGET_HOST, () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n')
    up.write(`${req.method} ${path} HTTP/1.1\r\n${headers}\r\n\r\n`)
    if (head && head.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})

server.listen(LISTEN, '127.0.0.1', () => {
  console.log(`proxy http://127.0.0.1:${LISTEN}${PREFIX}/ -> ${TARGET_HOST}:${TARGET_PORT}`)
})
