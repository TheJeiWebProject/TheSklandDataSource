import { JSDOM, VirtualConsole } from 'jsdom'
import { Script } from 'vm'
import { readFileSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SKLAND_SM_CONFIG = {
  organization: "UWXspnCCJN4sfYlNfqps",
  appId: "default",
  publicKey: "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCmxMNr7n8ZeT0tE1R9j/mPixoinPkeM+k4VGIn/s0k7N5rJAfnZ0eMER+QhwFvshzo0LNmeUkpR8uIlU/GEVr8mN28sKmwd2gpygqj0ePnBmOW4v0ZVwbSYK+izkhVFk2V/doLoMbWy6b+UnA8mkjvg0iYWRByfRsK2gdl7llqCwIDAQAB",
  protocol: "https"
}

export class SklandClient {
  constructor(token, smSdkPath = null) {
    this.token = token || ''
    this.smSdkPath = smSdkPath || path.resolve(__dirname, './sm.sdk.js')
    this.deviceId = null
    this.debug = process.env.DEBUG_PROXY === '1'
  }

  async createDeviceId() {
    return new Promise((resolve, reject) => {
      try {
        const virtualConsole = new VirtualConsole()
        virtualConsole.on('jsdomError', () => {
          // Ignore jsdom not-implemented noise (canvas, layout, etc).
        })

        const dom = new JSDOM('', {
          runScripts: 'outside-only',
          virtualConsole,
          beforeParse(window) {
            // smsdk probes canvas fingerprint APIs; provide a minimal mock.
            if (window.HTMLCanvasElement && window.HTMLCanvasElement.prototype) {
              window.HTMLCanvasElement.prototype.getContext = () => ({
                textBaseline: 'alphabetic',
                fillStyle: '#000',
                strokeStyle: '#000',
                font: '14px Arial',
                fillRect() {},
                clearRect() {},
                beginPath() {},
                moveTo() {},
                lineTo() {},
                stroke() {},
                closePath() {},
                arc() {},
                fillText() {},
                measureText() {
                  return { width: 0 };
                },
                getImageData() {
                  return { data: [] };
                }
              })
            }
            window._smReadyFuncs = [
              () => {
                resolve(window.SMSdk.getDeviceId())
              }
            ]
            window._smConf = SKLAND_SM_CONFIG
          }
        })

        const script = new Script(readFileSync(this.smSdkPath, 'utf-8'))
        const vmContext = dom.getInternalVMContext()
        script.runInContext(vmContext)
      } catch (error) {
        reject(error)
      }
    })
  }

  generateSign(path, params = '') {
    // 1. 时间戳
    const timestamp = Math.floor(Date.now() / 1000).toString()

    // 2. 拼接签名字符串
    let signStr = path || ''
    signStr += params || '' // GET是query参数，POST是body字符串
    signStr += timestamp

    // 3. 拼接 Header JSON
    const headerSubset = {
      platform: '3',
      timestamp: timestamp,
      dId: this.deviceId || '',
      vName: '1.0.0'
    }
    signStr += JSON.stringify(headerSubset)

    if (process.env.DEBUG_SIGN === '1') {
      console.log('Sign string:', signStr)
    }

    // 4. HMAC-SHA256
    const hmac = crypto.createHmac('sha256', this.token)
    hmac.update(signStr)
    const hmacResult = hmac.digest('hex')

    // 5. MD5
    const md5 = crypto.createHash('md5')
    md5.update(hmacResult)
    const finalSign = md5.digest('hex')

    if (process.env.DEBUG_SIGN === '1') {
      console.log('Sign MD5:', finalSign)
    }

    return {
      sign: finalSign,
      timestamp: timestamp
    }
  }

  async initializeDeviceId() {
    if (!this.deviceId) {
      this.deviceId = await this.createDeviceId()
      if (this.debug) {
        console.log(`Device ID generated: ${this.deviceId}`)
      }
    }
    return this.deviceId
  }

  async refreshToken() {
    // 初始化 deviceId
    await this.initializeDeviceId()

    // 使用空字符串作为 token 来请求 refresh 接口
    const originalToken = this.token
    this.token = ''

    try {
      const apiPath = '/web/v1/auth/refresh'
      const { sign, timestamp } = this.generateSign(apiPath, '')
      const headers = this.buildHeaders(sign, timestamp)

      if (this.debug) {
        console.log('Headers:', JSON.stringify(headers, null, 2))
      }

      const response = await axios({
        method: 'GET',
        url: 'https://zonai.skland.com' + apiPath,
        headers: headers
      })

      if (this.debug) {
        console.log('刷新成功!')
        console.log(JSON.stringify(response.data, null, 2))
      }

      // 更新 token
      if (response.data && response.data.data && response.data.data.token) {
        this.token = response.data.data.token
        if (this.debug) {
          console.log('token:', this.token)
        }
      }

      return response.data
    } catch (error) {
      // 恢复原来的 token
      this.token = originalToken
      console.error('Token refresh failed:', error.response?.data || error.message)
      throw error
    }
  }

  buildHeaders(sign, timestamp) {
    return {
      'platform': '3',
      'timestamp': timestamp,
      'dId': this.deviceId || '',
      'vName': '1.0.0',
      'sign': sign,
      'Content-Type': 'application/json'
    }
  }

  async request(method, url, options = {}) {
    await this.initializeDeviceId()

    const urlObj = new URL(url)
    const apiPath = urlObj.pathname
    const queryString = urlObj.search ? urlObj.search.substring(1) : ''

    let signData = ''
    if (method.toLowerCase() === 'get') {
      signData = queryString
    } else if (options.data) {
      signData = typeof options.data === 'string' ? options.data : JSON.stringify(options.data)
    }

    const { sign, timestamp } = this.generateSign(apiPath, signData)
    const headers = this.buildHeaders(sign, timestamp)

    const config = {
      method,
      url,
      headers: {
        ...headers,
        ...options.headers
      },
      ...options
    }

    if (this.debug) {
      console.log(`\nRequesting: ${method.toUpperCase()} ${url}`)
      console.log('Headers:', JSON.stringify(headers, null, 2))
    }

    try {
      const response = await axios(config)
      return response.data
    } catch (error) {
      console.error('Request failed:', error.response?.data || error.message)
      throw error
    }
  }

  async get(url, options = {}) {
    return this.request('GET', url, options)
  }

  async post(url, data, options = {}) {
    return this.request('POST', url, { ...options, data })
  }

  async put(url, data, options = {}) {
    return this.request('PUT', url, { ...options, data })
  }

  async delete(url, options = {}) {
    return this.request('DELETE', url, options)
  }
}
