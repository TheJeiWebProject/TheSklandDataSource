import express from 'express'
import { SklandClient } from './lib/proxy/skland-client.js'

const app = express()
const PORT = process.env.PORT || 12345

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'skland-proxy',
    time: new Date().toISOString()
  })
})

// CORS 中间件
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'X-Path, X-Params, X-Token, X-Device-Id, X-Method, X-Url, X-Data, Content-Type')

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})

// 存储客户端实例（使用 Map 来支持多个 token）
const clients = new Map()

// 获取或创建客户端实例
function getClient(token = '') {
  const key = token || 'default'
  if (!clients.has(key)) {
    const client = new SklandClient(token)
    clients.set(key, client)
  }
  return clients.get(key)
}

function getUrlFromRequest(req) {
  const q = typeof req.query?.url === 'string' ? req.query.url.trim() : ''
  const h = typeof req.headers['x-url'] === 'string' ? req.headers['x-url'].trim() : ''
  return q || h
}

function isHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function proxyRawResponse(url, req, res) {
  const upstream = await fetch(url, {
    method: req.method,
    headers: {
      'user-agent': req.headers['user-agent'] || 'jei-web-skland-proxy/1.0',
      'accept': req.headers.accept || '*/*'
    },
    redirect: 'follow'
  })

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      success: false,
      error: `上游请求失败: HTTP ${upstream.status}`,
      url
    })
  }

  const contentType = upstream.headers.get('content-type')
  const contentLength = upstream.headers.get('content-length')
  const cacheControl = upstream.headers.get('cache-control')

  if (contentType) res.setHeader('Content-Type', contentType)
  if (contentLength) res.setHeader('Content-Length', contentLength)
  if (cacheControl) res.setHeader('Cache-Control', cacheControl)
  else res.setHeader('Cache-Control', 'public, max-age=3600')

  const data = Buffer.from(await upstream.arrayBuffer())
  return res.status(200).send(data)
}

async function handleProxyImageRequest(req, res) {
  try {
    const url = getUrlFromRequest(req)
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'url query 或 X-Url header 是必需的'
      })
    }
    if (!isHttpUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'url 必须是 http/https'
      })
    }
    return await proxyRawResponse(url, req, res)
  } catch (error) {
    console.error('图片代理失败:', error)
    return res.status(500).json({
      success: false,
      error: error.message || '图片代理失败'
    })
  }
}

app.get('/api/proxy/image', handleProxyImageRequest)

// 代理请求到 Skland API
app.get('/proxy-request', async (req, res) => {
  try {
    const method = req.headers['x-method'] || 'GET'
    const url = getUrlFromRequest(req)
    const token = req.headers['x-token'] || ''
    const dataHeader = req.headers['x-data']
    const fromQuery = typeof req.query?.url === 'string' && req.query.url.trim() !== ''

    let data = null
    if (dataHeader) {
      try {
        data = JSON.parse(dataHeader)
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: 'X-Data header 必须是有效的 JSON 字符串'
        })
      }
    }

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'url query 或 X-Url header 是必需的'
      })
    }

    if (!isHttpUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'url 必须是 http/https'
      })
    }

    // 浏览器 <img> 无法设置 X-Url header，支持 ?url= 直接透传响应。
    if (fromQuery) {
      return await proxyRawResponse(url, req, res)
    }

    const client = getClient(token)
    await client.refreshToken()

    let result

    switch (method.toUpperCase()) {
      case 'GET':
        result = await client.get(url)
        break
      case 'POST':
        result = await client.post(url, data)
        break
      case 'PUT':
        result = await client.put(url, data)
        break
      case 'DELETE':
        result = await client.delete(url)
        break
      default:
        return res.status(400).json({
          success: false,
          error: `不支持的 HTTP 方法: ${method}`
        })
    }

    res.json({
      success: true,
      data: result
    })
  } catch (error) {
    console.error('代理请求失败:', error)
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    })
  }
})

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  res.status(500).json({
    success: false,
    error: '服务器内部错误',
    message: err.message
  })
})

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Skland Sign Server 已启动                            ║
║                                                           ║
║   服务地址: http://localhost:${PORT}                        ║
║                                                           ║
║   所有端点使用 GET 请求，参数通过 Header 传递              ║
║                                                           ║
║   可用端点:                                               ║
║   • GET  /                   - API 文档                  ║
║   • GET  /health             - 健康检查                  ║
║   • GET  /generate-did       - 生成 Device ID            ║
║   • GET  /generate-sign      - 生成签名                  ║
║   • GET  /sign-request       - 一站式签名服务            ║
║   • GET  /refresh-token      - 刷新 Token                ║
║   • GET  /proxy-request      - 代理请求到 Skland API     ║
║                                                           ║
║   Header 参数:                                            ║
║   • X-Path: API 路径                                     ║
║   • X-Params: URL 参数                                   ║
║   • X-Token: 用户 Token                                  ║
║   • X-Device-Id: 设备 ID                                 ║
║   • X-Method: HTTP 方法                                  ║
║   • X-Url: 完整 URL                                      ║
║   • X-Data: JSON 数据                                    ║
║                                                           ║
║   使用 Ctrl+C 停止服务器                                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `)
})

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('\n正在关闭服务器...')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...')
  process.exit(0)
})
